const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { dbRun, dbAll, dbGet, dbTransaction } = require('./database');

// Directorios de guardado
const dataDir = path.join(__dirname, 'data');
const savesDir = path.join(dataDir, 'saves');
const backupsDir = path.join(savesDir, 'backups');

function ensureDirectories() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(savesDir)) fs.mkdirSync(savesDir, { recursive: true });
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
}

// Mapa de debouncing para no saturar disco en ráfagas de cambios
const pendingSaveTimers = new Map();
const lastSnapshotTimers = new Map();

// Set para evitar escrituras concurrentes superpuestas sobre la misma partida
const isSavingPartida = new Set();

// Helper para escritura atómica asíncrona (no bloquea el Event Loop de Node.js)
async function writeJsonAtomic(filePath, data) {
  const tempPath = `${filePath}.tmp_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  // Serialización sin indentación para máxima velocidad y menor consumo de CPU
  const jsonString = JSON.stringify(data);
  await fs.promises.writeFile(tempPath, jsonString, 'utf8');
  await fs.promises.rename(tempPath, filePath);
}

// Limpiar cualquier sufijo de restauración o copia (repetitivo o variante)
function limpiarNombrePartida(nombre) {
  if (!nombre) return 'Partida';
  let limpio = String(nombre);
  while (/[\(\[\{\-_]?(?:restaurada|restaurado|copia|backup)[\)\]\}]?/i.test(limpio)) {
    limpio = limpio.replace(/\s*[\(\[\{\-_]?(?:restaurada|restaurado|copia|backup)[\)\]\}]?/gi, '');
  }
  return limpio.replace(/[\s\-_]+$/g, '').trim() || 'Partida';
}

// Extraer todos los datos de una partida desde SQLite
async function exportPartidaData(partidaId) {
  const partida = await dbGet(`SELECT * FROM partidas WHERE id = ?`, [partidaId]);
  if (!partida) return null;
  partida.nombre = limpiarNombrePartida(partida.nombre);

  const escenas = await dbAll(`SELECT * FROM escenas WHERE partida_id = ?`, [partidaId]);
  const fichas = await dbAll(`SELECT * FROM fichas WHERE partida_id = ?`, [partidaId]);
  const figuras = await dbAll(`SELECT f.* FROM figuras f JOIN escenas e ON f.escena_id = e.id WHERE e.partida_id = ?`, [partidaId]);
  const dibujos = await dbAll(`SELECT d.* FROM dibujos d JOIN escenas e ON d.escena_id = e.id WHERE e.partida_id = ?`, [partidaId]);
  const posiciones_fichas = await dbAll(`SELECT pf.* FROM posiciones_fichas pf JOIN escenas e ON pf.escena_id = e.id WHERE e.partida_id = ?`, [partidaId]);
  const mensajes = await dbAll(`SELECT * FROM mensajes WHERE partida_id = ? ORDER BY datetime(fecha) ASC`, [partidaId]);
  const historial = await dbAll(`SELECT * FROM historial_dados WHERE partida_id = ? ORDER BY datetime(fecha) DESC`, [partidaId]);
  const galeria = await dbAll(`SELECT * FROM galeria WHERE partida_id = ?`, [partidaId]);

  return {
    version: '2.0.0',
    fechaExport: new Date().toISOString(),
    partida,
    escenas,
    fichas,
    posiciones_fichas,
    figuras,
    dibujos,
    mensajes,
    historial,
    galeria
  };
}

// Guardar partida en archivo JSON independiente (100% asíncrono, cero bloqueos)
async function savePartidaToFile(partidaId, createSnapshot = false) {
  if (!partidaId) return false;
  if (isSavingPartida.has(partidaId)) {
    // Si ya está en curso una operación de guardado para esta partida, re-programar
    scheduleAutoSave(partidaId, 1000);
    return false;
  }
  isSavingPartida.add(partidaId);

  try {
    ensureDirectories();
    const backupData = await exportPartidaData(partidaId);
    if (!backupData || !backupData.partida) return false;
    backupData.partida.nombre = limpiarNombrePartida(backupData.partida.nombre);

    const codigo = (backupData.partida.codigo || 'UNKNOWN').toUpperCase();
    const safeName = (backupData.partida.nombre || 'partida').replace(/[^a-zA-Z0-9_\-]/g, '_');

    // 1. Archivo principal independiente de la partida
    const mainFilePath = path.join(savesDir, `partida_${codigo}.json`);
    await writeJsonAtomic(mainFilePath, backupData);

    // 2. Snapshot periódico o manual (máximo 5 por partida)
    const now = Date.now();
    const lastSnapshot = lastSnapshotTimers.get(partidaId) || 0;
    const TEN_MINUTES = 10 * 60 * 1000;

    if (createSnapshot || (now - lastSnapshot > TEN_MINUTES)) {
      lastSnapshotTimers.set(partidaId, now);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const snapshotFilename = `${codigo}_${safeName}_${timestamp}.json`;
      const snapshotPath = path.join(backupsDir, snapshotFilename);

      try {
        await fs.promises.copyFile(mainFilePath, snapshotPath);
      } catch (_) {
        await writeJsonAtomic(snapshotPath, backupData);
      }

      // Rotación: mantener sólo los 5 snapshots más recientes de este código
      cleanOldSnapshots(codigo, 5);
    }

    return true;
  } catch (err) {
    console.error(`[SavesManager] Error al guardar partida ${partidaId} en archivo:`, err);
    return false;
  } finally {
    isSavingPartida.delete(partidaId);
  }
}

// Rotación de snapshots antiguos
function cleanOldSnapshots(codigo, maxKeep = 5) {
  try {
    if (!fs.existsSync(backupsDir)) return;
    const files = fs.readdirSync(backupsDir)
      .filter(f => f.startsWith(`${codigo}_`) && f.endsWith('.json'))
      .map(f => ({
        name: f,
        path: path.join(backupsDir, f),
        time: fs.statSync(path.join(backupsDir, f)).mtimeMs
      }))
      .sort((a, b) => b.time - a.time);

    if (files.length > maxKeep) {
      const toDelete = files.slice(maxKeep);
      for (const item of toDelete) {
        try { fs.unlinkSync(item.path); } catch (_) {}
      }
    }
  } catch (err) {
    console.error('[SavesManager] Error en rotación de snapshots:', err);
  }
}

// Programar auto-guardado con debounce (ej. 3.5 segundos tras el último cambio)
function scheduleAutoSave(partidaId, delayMs = 3500) {
  if (!partidaId) return;
  if (pendingSaveTimers.has(partidaId)) {
    clearTimeout(pendingSaveTimers.get(partidaId));
  }

  const timer = setTimeout(async () => {
    pendingSaveTimers.delete(partidaId);
    await savePartidaToFile(partidaId, false);
  }, delayMs);

  pendingSaveTimers.set(partidaId, timer);
}

// Forzar guardado inmediato de todas las partidas activas
async function saveAllPartidasImmediate() {
  try {
    const partidas = await dbAll(`SELECT id FROM partidas`);
    for (const p of partidas) {
      await savePartidaToFile(p.id, false);
    }
  } catch (err) {
    console.error('[SavesManager] Error al guardar todas las partidas:', err);
  }
}

// Importar e insertar una estructura de partida completa en SQLite
async function importPartidaDataIntoDb(data, overrideExisting = false) {
  if (!data || !data.partida) throw new Error('Datos de partida inválidos.');

  const { partida, escenas = [], fichas = [], posiciones_fichas = [], figuras = [], dibujos = [], mensajes = [], historial = [], galeria = [] } = data;

  await dbTransaction(async () => {
    // Si ya existe y se permite sobrescribir, eliminar primero
    const existing = await dbGet(`SELECT id FROM partidas WHERE id = ? OR codigo = ?`, [partida.id, partida.codigo]);
    if (existing) {
      if (!overrideExisting) return; // Ya existe y no sobrescribir
      await dbRun(`DELETE FROM partidas WHERE id = ?`, [existing.id]);
    }

    // Insertar partida limpiando sufijos como '(Restaurada)'
    const nombreLimpio = limpiarNombrePartida(partida.nombre);
    partida.nombre = nombreLimpio;
    await dbRun(
      `INSERT OR REPLACE INTO partidas (id, nombre, codigo, dm_id, escena_activa_id, fecha_creacion, fecha_modificacion, config_grid_x, config_grid_y, config_casilla, imagen_portada)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [partida.id, nombreLimpio, partida.codigo, partida.dm_id || null, partida.escena_activa_id || null, partida.fecha_creacion || new Date().toISOString(), partida.fecha_modificacion || new Date().toISOString(), partida.config_grid_x || 40, partida.config_grid_y || 40, partida.config_casilla || 5, partida.imagen_portada || null]
    );

    // Insertar escenas
    for (const esc of escenas) {
      await dbRun(
        `INSERT OR REPLACE INTO escenas (id, partida_id, nombre, mapa, config_grid_x, config_grid_y, config_casilla)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [esc.id, partida.id, esc.nombre, esc.mapa || null, esc.config_grid_x || 40, esc.config_grid_y || 40, esc.config_casilla || 5]
      );
    }

    // Insertar fichas
    for (const f of fichas) {
      await dbRun(
        `INSERT OR REPLACE INTO fichas (id, partida_id, escena_id, nombre, tipo, jugador_id, imagen, fuerza, destreza, constitucion, inteligencia, sabiduria, carisma, hp_actual, hp_maximo, ac, velocidad, iniciativa, nivel, altura, tamanio_base, color_aro, gigante, notas, x, y, revelado, oculto)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          f.id, partida.id, f.escena_id, f.nombre, f.tipo || 'jugador', f.jugador_id || null, f.imagen,
          f.fuerza ?? 10, f.destreza ?? 10, f.constitucion ?? 10, f.inteligencia ?? 10, f.sabiduria ?? 10, f.carisma ?? 10,
          f.hp_actual ?? 10, f.hp_maximo ?? 10, f.ac ?? 10, f.velocidad ?? 30, f.iniciativa ?? 0, f.nivel ?? 1, f.altura ?? 2,
          f.tamanio_base || 'mediano', f.color_aro || '#c9a84c', f.gigante ? 1 : 0, f.notas || '',
          f.x ?? 0, f.y ?? 0,
          typeof f.revelado === 'object' ? JSON.stringify(f.revelado) : (f.revelado || '0'),
          f.oculto ? 1 : 0
        ]
      );
    }

    // Insertar posiciones de fichas
    for (const pf of posiciones_fichas) {
      await dbRun(
        `INSERT OR REPLACE INTO posiciones_fichas (ficha_id, escena_id, x, y) VALUES (?, ?, ?, ?)`,
        [pf.ficha_id, pf.escena_id, pf.x ?? 0, pf.y ?? 0]
      );
    }

    // Insertar figuras
    for (const fig of figuras) {
      await dbRun(
        `INSERT OR REPLACE INTO figuras (id, escena_id, tipo, x, y, tamanio, rotacion, color, transparencia, etiqueta, creador_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [fig.id, fig.escena_id, fig.tipo, fig.x, fig.y, fig.tamanio, fig.rotacion || 0, fig.color, fig.transparencia, fig.etiqueta, fig.creador_id]
      );
    }

    // Insertar dibujos
    for (const d of dibujos) {
      await dbRun(
        `INSERT OR REPLACE INTO dibujos (id, escena_id, datos) VALUES (?, ?, ?)`,
        [d.id, d.escena_id, typeof d.datos === 'object' ? JSON.stringify(d.datos) : (d.datos || '[]')]
      );
    }

    // Insertar mensajes
    for (const m of mensajes) {
      await dbRun(
        `INSERT OR REPLACE INTO mensajes (id, partida_id, usuario_id, nombre_usuario, color_usuario, mensaje, es_gif, fecha, nombre_ficha)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [m.id, partida.id, m.usuario_id, m.nombre_usuario, m.color_usuario, m.mensaje, m.es_gif ? 1 : 0, m.fecha, m.nombre_ficha || null]
      );
    }

    // Insertar historial dados
    for (const h of historial) {
      await dbRun(
        `INSERT OR REPLACE INTO historial_dados (id, partida_id, usuario_id, nombre_usuario, formula, tipo, resultado, fecha, nombre_ficha)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [h.id, partida.id, h.usuario_id, h.nombre_usuario, h.formula, h.tipo, h.resultado, h.fecha, h.nombre_ficha || null]
      );
    }

    // Insertar galería
    for (const g of galeria) {
      await dbRun(
        `INSERT OR REPLACE INTO galeria (id, partida_id, nombre, datos) VALUES (?, ?, ?, ?)`,
        [g.id, partida.id, g.nombre, typeof g.datos === 'object' ? JSON.stringify(g.datos) : g.datos]
      );
    }
  });
}

// Auto-restaurar todas las partidas desde archivos si faltan en la base de datos (por ejemplo, tras caída del host o reinicio de contenedor)
async function autoRestoreFromFiles() {
  ensureDirectories();
  if (!fs.existsSync(savesDir)) return;

  // 1. Recuperar archivos principales si faltan en savesDir pero existen copias en backups/
  if (fs.existsSync(backupsDir)) {
    try {
      const backupFiles = fs.readdirSync(backupsDir).filter(f => f.endsWith('.json'));
      const byCode = new Map();
      for (const file of backupFiles) {
        const code = file.split('_')[0];
        if (!code || code.length !== 6) continue;
        if (!byCode.has(code)) byCode.set(code, []);
        byCode.get(code).push(file);
      }

      for (const [code, files] of byCode.entries()) {
        const mainPath = path.join(savesDir, `partida_${code}.json`);
        if (!fs.existsSync(mainPath)) {
          files.sort().reverse();
          const latestFile = files[0];
          try {
            fs.copyFileSync(path.join(backupsDir, latestFile), mainPath);
            console.log(`📦 [SavesManager] Archivo principal generado para ${code} a partir de backup ${latestFile}`);
          } catch (_) {}
        }
      }
    } catch (err) {
      console.error('[SavesManager] Error al verificar backups huérfanos:', err);
    }
  }

  // 2. Escanear todos los archivos independientes partida_*.json
  const saveFiles = fs.readdirSync(savesDir).filter(f => f.startsWith('partida_') && f.endsWith('.json'));
  if (saveFiles.length === 0) return;

  let restoredCount = 0;
  for (const filename of saveFiles) {
    try {
      const filePath = path.join(savesDir, filename);
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);

      if (!data || !data.partida || (!data.partida.id && !data.partida.codigo)) continue;

      // Verificar si existe en la base de datos actual (por id o por código)
      const exists = await dbGet(
        `SELECT id, fecha_modificacion FROM partidas WHERE id = ? OR codigo = ?`,
        [data.partida.id, data.partida.codigo]
      );

      if (!exists) {
        console.log(`⚡ [SavesManager] Partida "${data.partida.nombre}" (${data.partida.codigo}) no encontrada en BD. Restaurando automáticamente...`);
        await importPartidaDataIntoDb(data, false);
        restoredCount++;
      } else {
        // Si la base de datos no tiene escenas pero el archivo JSON sí las tiene, o si el archivo JSON es más reciente que la BD
        const escenasDb = await dbGet(`SELECT COUNT(*) as count FROM escenas WHERE partida_id = ?`, [exists.id]);
        const fileHasScenes = (data.escenas && data.escenas.length > 0);
        const fileDate = new Date(data.partida.fecha_modificacion || 0).getTime();
        const dbDate = new Date(exists.fecha_modificacion || 0).getTime();

        if ((escenasDb?.count === 0 && fileHasScenes) || (fileDate > dbDate + 2000)) {
          console.log(`🔄 [SavesManager] Sincronizando partida "${data.partida.nombre}" (${data.partida.codigo}) con versión más reciente desde archivo JSON...`);
          await importPartidaDataIntoDb(data, true);
          restoredCount++;
        }
      }
    } catch (err) {
      console.error(`❌ [SavesManager] Error al procesar archivo de guardado ${filename}:`, err);
    }
  }

  if (restoredCount > 0) {
    console.log(`✅ [SavesManager] ¡Se sincronizaron automáticamente ${restoredCount} partidas desde los archivos de guardado independientes!`);
  }
}

// Listar copias de seguridad de una partida
function listBackupsForPartida(codigo) {
  ensureDirectories();
  const upperCode = (codigo || '').toUpperCase();
  const list = [];

  // Snapshot principal
  const mainFile = path.join(savesDir, `partida_${upperCode}.json`);
  if (fs.existsSync(mainFile)) {
    const stat = fs.statSync(mainFile);
    list.push({
      tipo: 'principal',
      nombreArchivo: `partida_${upperCode}.json`,
      tamanoKb: Math.round(stat.size / 1024),
      fecha: new Date(stat.mtimeMs).toISOString()
    });
  }

  // Snapshots históricos
  if (fs.existsSync(backupsDir)) {
    const files = fs.readdirSync(backupsDir).filter(f => f.startsWith(`${upperCode}_`) && f.endsWith('.json'));
    for (const f of files) {
      const fullPath = path.join(backupsDir, f);
      const stat = fs.statSync(fullPath);
      list.push({
        tipo: 'snapshot',
        nombreArchivo: f,
        tamanoKb: Math.round(stat.size / 1024),
        fecha: new Date(stat.mtimeMs).toISOString()
      });
    }
  }

  list.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  return list;
}

// Restaurar un snapshot específico
async function restoreSnapshotFile(codigo, filename) {
  ensureDirectories();
  const upperCode = (codigo || '').toUpperCase();

  // Buscar en savesDir o backupsDir
  let targetPath = path.join(backupsDir, filename);
  if (!fs.existsSync(targetPath)) {
    targetPath = path.join(savesDir, filename);
  }

  if (!fs.existsSync(targetPath)) {
    throw new Error('Archivo de copia de seguridad no encontrado.');
  }

  const content = fs.readFileSync(targetPath, 'utf8');
  const data = JSON.parse(content);
  if (!data || !data.partida) {
    throw new Error('El archivo de copia de seguridad está dañado o tiene un formato no reconocido.');
  }

  data.partida.nombre = limpiarNombrePartida(data.partida.nombre);
  await importPartidaDataIntoDb(data, true);
  return data.partida;
}

module.exports = {
  ensureDirectories,
  exportPartidaData,
  savePartidaToFile,
  scheduleAutoSave,
  saveAllPartidasImmediate,
  autoRestoreFromFiles,
  listBackupsForPartida,
  restoreSnapshotFile,
  limpiarNombrePartida
};
