require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { dbRun, dbAll, dbGet, dbTransaction, initDb, checkpointDb, dataDir, isPostgres } = require('./database');
const {
  ensureDirectories,
  savePartidaToFile,
  scheduleAutoSave,
  saveAllPartidasImmediate,
  autoRestoreFromFiles,
  listBackupsForPartida,
  restoreSnapshotFile,
  limpiarNombrePartida,
  deletePartidaFiles,
  uploadsDir,
  mapsDir,
  guardarMapaEnDisco,
  eliminarMapaDeDisco,
  migrarMapasExistentes,
  obtenerMapaComoBase64,
  buscarMapaEnBackups
} = require('./saves_manager');

let compression = null;
try {
  compression = require('compression');
} catch (_) {
  console.warn('⚠️ [Servidor] Librería compression no instalada aún en este contenedor. Continuando sin compresión HTTP.');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e8, // 100MB para imágenes de mapa base64 de alta resolución
  pingTimeout: 60000, // 60s para evitar falsos positivos de desconexión en Railway / redes móviles
  pingInterval: 25000, // Heartbeat cada 25s (estándar recomendado Socket.IO)
  transports: ['websocket', 'polling'], // Priorizar WebSocket directo con fallback
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true
  }
});

// 1. Compresión HTTP GZIP/Deflate opcional (si está disponible en node_modules)
if (compression) {
  app.use(compression({
    threshold: 1024 // Comprime todo payload mayor a 1KB
  }));
}

app.use(cors());
app.use(express.json({ limit: '100mb' }));

// 2. Servir archivos estáticos con ETag y encabezados de caché eficientes
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      // HTML siempre valida con ETag para recibir 304 instantáneo o actualizar si cambia
      res.set('Cache-Control', 'no-cache');
    } else {
      // JS, CSS, fuentes e imágenes se benefician de caché del navegador con validación revalidate
      res.set('Cache-Control', 'public, max-age=86400, must-revalidate');
    }
  }
}));

// Servir archivos estáticos de uploads (mapas e imágenes desacopladas en disco)
app.use('/uploads', express.static(uploadsDir, {
  maxAge: '7d',
  etag: true,
  lastModified: true,
  setHeaders: (res) => {
    res.set('Cache-Control', 'public, max-age=604800, must-revalidate');
  }
}));

// Helper para verificar y auto-sanear escenas cuyo mapa apunta a un archivo que ya no existe en disco ni en BD
async function verificarMapaEscena(escena) {
  if (!escena || !escena.mapa) return;
  if (!escena.mapa.startsWith('/api/escenas/')) return;

  const prefix = `${escena.id}.`;
  let existsOnDisk = false;
  try {
    if (fs.existsSync(mapsDir)) {
      existsOnDisk = fs.readdirSync(mapsDir).some(f => f.startsWith(prefix));
    }
  } catch (_) { }
  if (existsOnDisk) return;

  // Si no está en disco, verificar si existe mapa_data en la BD
  try {
    const row = await dbGet(`SELECT mapa_data FROM escenas WHERE id = ?`, [escena.id]);
    if (row?.mapa_data && typeof row.mapa_data === 'string' && row.mapa_data.startsWith('data:')) {
      try { await guardarMapaEnDisco(escena.id, row.mapa_data); } catch (_) { }
      return;
    }
  } catch (_) { }

  // Verificar si está en algún backup/snapshot
  try {
    if (typeof buscarMapaEnBackups === 'function') {
      const b64 = await buscarMapaEnBackups(escena.id);
      if (b64) {
        try {
          await dbRun(`UPDATE escenas SET mapa_data = ? WHERE id = ?`, [b64, escena.id]);
          await guardarMapaEnDisco(escena.id, b64);
        } catch (_) { }
        return;
      }
    }
  } catch (_) { }

  // Si no existe en ningún lado (archivo huérfano de un reinicio previo de Railway):
  // Limpiar el enlace roto de la BD para que el cliente no intente descargarlo ni genere 404
  try {
    await dbRun(`UPDATE escenas SET mapa = NULL WHERE id = ?`, [escena.id]);
  } catch (_) { }
  escena.mapa = null;
}

// Endpoint HTTP optimizado para streaming de mapas de escenas con soporte de ETag y Cache-Control
app.get('/api/escenas/:id/mapa', async (req, res) => {
  try {
    const { id } = req.params;
    if (!fs.existsSync(mapsDir)) {
      fs.mkdirSync(mapsDir, { recursive: true });
    }
    const files = fs.readdirSync(mapsDir);
    const prefix = `${id}.`;
    const matchedFile = files.find(f => f.startsWith(prefix));

    if (matchedFile) {
      const fullPath = path.join(mapsDir, matchedFile);
      const ext = path.extname(matchedFile).toLowerCase();
      let contentType = 'image/webp';
      if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
      else if (ext === '.png') contentType = 'image/png';
      else if (ext === '.gif') contentType = 'image/gif';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=604800, must-revalidate');
      return res.sendFile(fullPath);
    }

    // Fallback 1: verificar si está en PostgreSQL / SQLite (en mapa_data o mapa como data:image)
    const escena = await dbGet(`SELECT mapa, mapa_data FROM escenas WHERE id = ?`, [id]);
    let rawData = (escena?.mapa_data && typeof escena.mapa_data === 'string' && escena.mapa_data.startsWith('data:')) ? escena.mapa_data : null;
    if (!rawData && escena?.mapa && typeof escena.mapa === 'string' && escena.mapa.startsWith('data:')) {
      rawData = escena.mapa;
    }

    // Fallback 2: si no está en disco ni en BD (ej. reinicio de contenedor en Railway), buscar en backups locales
    if (!rawData && typeof buscarMapaEnBackups === 'function') {
      rawData = await buscarMapaEnBackups(id);
      if (rawData) {
        try {
          await dbRun(`UPDATE escenas SET mapa_data = ? WHERE id = ?`, [rawData, id]);
        } catch (_) { }
      }
    }

    if (rawData && rawData.startsWith('data:')) {
      // Regenerar en caché de disco para acelerar próximas peticiones
      try {
        await guardarMapaEnDisco(id, rawData);
      } catch (_) { }

      const matches = rawData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const contentType = matches[1];
        const buffer = Buffer.from(matches[2], 'base64');
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=604800, must-revalidate');
        return res.send(buffer);
      }
    } else if (escena && escena.mapa && escena.mapa.startsWith('/uploads/')) {
      const localPath = path.join(dataDir, escena.mapa.replace(/^\//, ''));
      if (fs.existsSync(localPath)) {
        return res.sendFile(localPath);
      }
    }

    // Si no se encuentra en ningún lado (archivo huérfano de un reinicio anterior):
    // Limpiar en BD para evitar futuras llamadas rotas
    try {
      await dbRun(`UPDATE escenas SET mapa = NULL WHERE id = ?`, [id]);
    } catch (_) { }

    // Responder 200 con pixel transparente para no registrar error 404 rojo en la consola del navegador
    const emptyPixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('X-Map-Status', 'empty');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(emptyPixel);
  } catch (err) {
    console.error('Error al servir mapa de escena:', err);
    return res.status(500).json({ error: 'Error interno al servir el mapa' });
  }
});

// Función para generar código alfanumérico único de 6 caracteres
function generarCodigoPartida() {
  const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let codigo = '';
  for (let i = 0; i < 6; i++) {
    codigo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
  }
  return codigo;
}

// Colores únicos para asignar a usuarios
const COLORES_USUARIOS = [
  '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c',
  '#3498db', '#9b59b6', '#fd79a8', '#00cec9', '#6c5ce7'
];

// Mapa de usuarios conectados por partida { partidaId: Map<usuarioId, { id, nombre, esDM, color, socketId }> }
const connectedUsers = new Map();

// --- REST ENDPOINTS ---

// Throttling de escaneo de backups en disco para respuestas ultra rápidas
let lastAutoRestoreTimestamp = 0;
let isAutoRestoring = false;
async function autoRestoreFilesThrottled() {
  const now = Date.now();
  if (now - lastAutoRestoreTimestamp > 60000 && !isAutoRestoring) { // Máximo cada 60 segundos
    lastAutoRestoreTimestamp = now;
    isAutoRestoring = true;
    try {
      await autoRestoreFromFiles();
    } catch (e) {
      console.warn('[AutoRestore]', e.message);
    } finally {
      isAutoRestoring = false;
    }
  }
}

// Listar todas las partidas guardadas (Respuesta instantánea con campos optimizados)
app.get('/api/partidas', async (req, res) => {
  try {
    // Sincronización asíncrona en segundo plano (no bloquea el response HTTP)
    autoRestoreFilesThrottled().catch(() => { });

    const partidas = await dbAll(`
      SELECT p.id, p.nombre, p.codigo, p.dm_id, p.escena_activa_id, p.fecha_creacion, p.fecha_modificacion,
             p.config_grid_x, p.config_grid_y, p.config_casilla, p.imagen_portada,
        (SELECT COUNT(DISTINCT f.jugador_id) FROM fichas f WHERE f.partida_id = p.id AND f.jugador_id IS NOT NULL) as total_jugadores
      FROM partidas p 
      ORDER BY p.fecha_modificacion DESC
    `);
    partidas.forEach(p => {
      p.nombre = limpiarNombrePartida(p.nombre);
    });
    res.json(partidas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear una nueva partida
app.post('/api/partidas', async (req, res) => {
  try {
    const { nombre, creatorId, configGridX = 40, configGridY = 40, configCasilla = 5, imagenPortada = null } = req.body;
    const partidaId = uuidv4();
    const escenaId = uuidv4();
    const codigo = generarCodigoPartida();
    const ahora = new Date().toISOString();

    // Insertar partida limpiando nombre
    const nombreLimpio = limpiarNombrePartida(nombre || 'Nueva Partida');
    await dbRun(
      `INSERT INTO partidas (id, nombre, codigo, dm_id, escena_activa_id, fecha_creacion, fecha_modificacion, config_grid_x, config_grid_y, config_casilla, imagen_portada)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [partidaId, nombreLimpio, codigo, creatorId || null, escenaId, ahora, ahora, configGridX, configGridY, configCasilla, imagenPortada]
    );

    // Crear escena por defecto
    await dbRun(
      `INSERT INTO escenas (id, partida_id, nombre, mapa, config_grid_x, config_grid_y, config_casilla) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [escenaId, partidaId, 'Mazmorra Principal', null, configGridX, configGridY, configCasilla]
    );

    // Guardar inmediatamente en archivo JSON independiente y snapshot inicial
    await savePartidaToFile(partidaId, true);

    res.json({ id: partidaId, codigo, escenaId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar partida
app.delete('/api/partidas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const partida = await dbGet(`SELECT id, codigo, nombre FROM partidas WHERE id = ? OR codigo = ?`, [id, id]);
    if (!partida) {
      return res.status(404).json({ error: 'Partida no encontrada.' });
    }

    const partidaId = partida.id;
    const codigo = partida.codigo;

    // 1. Limpiar archivos en disco y detener temporizadores de auto-guardado
    deletePartidaFiles(partidaId, codigo);

    // 2. Eliminar de la base de datos (cascada elimina escenas, fichas, dibujos, etc.)
    await dbRun(`DELETE FROM partidas WHERE id = ?`, [partidaId]);

    // 3. Notificar a los clientes conectados a esta partida que ha sido eliminada
    io.to(partidaId).emit('partida_eliminada', {
      mensaje: `La partida "${partida.nombre}" ha sido eliminada por el Dungeon Master.`
    });

    res.json({ success: true, id: partidaId, codigo });
  } catch (err) {
    console.error('Error al eliminar partida:', err);
    res.status(500).json({ error: err.message });
  }
});

// Modificar datos de la partida (nombre e imagen de portada) - Solo creador / DM
app.put('/api/partidas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, imagenPortada, usuarioId } = req.body;

    const partida = await dbGet(`SELECT * FROM partidas WHERE id = ?`, [id]);
    if (!partida) {
      return res.status(404).json({ error: 'Partida no encontrada' });
    }

    // Verificar si es el creador de la partida
    const effectiveUserId = (usuarioId || '').toLowerCase().trim();
    const dmId = (partida.dm_id || '').toLowerCase().trim();
    const esCreador = !dmId || dmId === effectiveUserId || (effectiveUserId && dmId.includes(effectiveUserId));

    if (!esCreador) {
      return res.status(403).json({ error: 'Solo el creador de la sesión puede modificarla.' });
    }

    const nombreLimpio = limpiarNombrePartida(nombre || partida.nombre);
    const nuevaImagen = imagenPortada !== undefined ? imagenPortada : partida.imagen_portada;
    const ahora = new Date().toISOString();

    await dbRun(
      `UPDATE partidas SET nombre = ?, imagen_portada = ?, fecha_modificacion = ? WHERE id = ?`,
      [nombreLimpio, nuevaImagen, ahora, id]
    );

    await savePartidaToFile(id, false);

    // Notificar en tiempo real a clientes conectados en la sala
    io.to(id).emit('partida_actualizada', {
      id,
      nombre: nombreLimpio,
      imagen_portada: nuevaImagen
    });

    res.json({ success: true, id, nombre: nombreLimpio, imagen_portada: nuevaImagen });
  } catch (err) {
    console.error('Error al actualizar partida:', err);
    res.status(500).json({ error: err.message });
  }
});

// Listar copias de seguridad de una partida
app.get('/api/partidas/:codigo/backups', (req, res) => {
  try {
    const { codigo } = req.params;
    const backups = listBackupsForPartida(codigo);
    res.json(backups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restaurar copia de seguridad específica
app.post('/api/partidas/:codigo/backups/restaurar', async (req, res) => {
  try {
    const { codigo } = req.params;
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'Nombre de archivo requerido.' });

    const partida = await restoreSnapshotFile(codigo, filename);
    partida.nombre = limpiarNombrePartida(partida.nombre);

    // Obtener escena activa restaurada
    let escenaActiva = await dbGet(`SELECT * FROM escenas WHERE id = ?`, [partida.escena_activa_id]);
    if (!escenaActiva) {
      escenaActiva = await dbGet(`SELECT * FROM escenas WHERE partida_id = ? ORDER BY id ASC LIMIT 1`, [partida.id]);
    }
    if (escenaActiva && partida.escena_activa_id !== escenaActiva.id) {
      await dbRun(`UPDATE partidas SET escena_activa_id = ? WHERE id = ?`, [escenaActiva.id, partida.id]);
      partida.escena_activa_id = escenaActiva.id;
    }

    const escenas = await dbAll(`SELECT id, partida_id, nombre, config_grid_x, config_grid_y, config_casilla FROM escenas WHERE partida_id = ?`, [partida.id]);
    const fichas = await dbAll(`SELECT * FROM fichas WHERE partida_id = ?`, [partida.id]);
    if (escenaActiva) {
      const posiciones = await dbAll(`SELECT * FROM posiciones_fichas WHERE escena_id = ?`, [escenaActiva.id]);
      fichas.forEach(f => {
        const pos = posiciones.find(p => p.ficha_id === f.id);
        if (pos) {
          f.x = pos.x;
          f.y = pos.y;
        }
      });
    }
    const figuras = escenaActiva ? await dbAll(`SELECT * FROM figuras WHERE escena_id = ?`, [escenaActiva.id]) : [];
    const dibujoRow = escenaActiva ? await dbGet(`SELECT datos FROM dibujos WHERE escena_id = ?`, [escenaActiva.id]) : null;
    const dibujos = dibujoRow ? JSON.parse(dibujoRow.datos || '[]') : [];
    const mensajes = await dbAll(`SELECT * FROM mensajes WHERE partida_id = ? ORDER BY fecha ASC LIMIT 100`, [partida.id]);
    const historial = await dbAll(`SELECT * FROM historial_dados WHERE partida_id = ? ORDER BY fecha DESC LIMIT 100`, [partida.id]);

    // Notificar a todos los clientes en la partida para que recarguen su estado inmediatamente con datos completos
    io.to(partida.id).emit('partida_restaurada', {
      mensaje: 'Partida cargada a la versión seleccionada.',
      partida,
      escenaActiva,
      escenas,
      fichas,
      figuras,
      dibujos,
      mensajes,
      historial
    });
    res.json({ success: true, partida });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Forzar guardado inmediato en archivo JSON y snapshot
app.post('/api/partidas/:id/guardar_ahora', async (req, res) => {
  try {
    const { id } = req.params;
    const partida = await dbGet(`SELECT id FROM partidas WHERE id = ? OR codigo = ?`, [id, String(id).toUpperCase()]);
    if (!partida) {
      return res.json({ success: false, notFound: true, message: 'Partida no activa o no encontrada' });
    }
    await savePartidaToFile(partida.id, true);
    res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Exportar partida completa (Backup JSON para guardar en Escritorio)
app.get('/api/partidas/:id/export', async (req, res) => {
  try {
    const { id } = req.params;
    const partida = await dbGet(`SELECT * FROM partidas WHERE id = ?`, [id]);
    if (!partida) return res.status(404).json({ error: 'Partida no encontrada' });
    partida.nombre = limpiarNombrePartida(partida.nombre);

    // Asegurar que si hay timers de guardado pendientes para esta partida, se persistan
    await savePartidaToFile(id, false);

    const escenas = await dbAll(`SELECT * FROM escenas WHERE partida_id = ?`, [id]);
    for (const esc of escenas) {
      if (esc.mapa && esc.mapa.startsWith('/api/escenas/')) {
        const b64 = await obtenerMapaComoBase64(esc.id);
        if (b64) esc.mapa = b64;
      }
    }
    const fichas = await dbAll(`SELECT * FROM fichas WHERE partida_id = ?`, [id]);
    const figuras = await dbAll(`SELECT f.* FROM figuras f JOIN escenas e ON f.escena_id = e.id WHERE e.partida_id = ?`, [id]);
    const dibujos = await dbAll(`SELECT d.* FROM dibujos d JOIN escenas e ON d.escena_id = e.id WHERE e.partida_id = ?`, [id]);
    const posiciones_fichas = await dbAll(`SELECT pf.* FROM posiciones_fichas pf JOIN escenas e ON pf.escena_id = e.id WHERE e.partida_id = ?`, [id]);
    const mensajes = await dbAll(`SELECT * FROM mensajes WHERE partida_id = ?`, [id]);
    const historial = await dbAll(`SELECT * FROM historial_dados WHERE partida_id = ?`, [id]);
    const galeria = await dbAll(`SELECT * FROM galeria WHERE partida_id = ?`, [id]);

    // Garantizar que la escena activa apunte a una escena válida (priorizar la que tiene mapa)
    if (!partida.escena_activa_id || !escenas.some(e => e.id === partida.escena_activa_id)) {
      const conMapa = escenas.find(e => e.mapa);
      partida.escena_activa_id = conMapa ? conMapa.id : (escenas[0]?.id || null);
    }

    const backup = {
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

    const fileName = `sesion_dnd_${(partida.nombre || 'partida').replace(/[^a-zA-Z0-9]/g, '_')}_${partida.codigo}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(JSON.stringify(backup));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Importar / Restaurar partida desde archivo JSON guardado en Escritorio
app.post('/api/partidas/import', async (req, res) => {
  try {
    const backupData = req.body;
    if (!backupData || !backupData.partida) {
      return res.status(400).json({ error: 'Formato de archivo de respaldo inválido.' });
    }

    const { partida, escenas = [], fichas = [], posiciones_fichas = [], figuras = [], dibujos = [], mensajes = [], historial = [], galeria = [] } = backupData;
    const importerUserId = (backupData.importerUserId || req.headers['x-user-id'] || '').trim();
    const finalDmId = importerUserId || partida.dm_id || null;

    const newPartidaId = uuidv4();
    const newCodigo = generarCodigoPartida();
    const ahora = new Date().toISOString();

    const escenaIdMap = new Map();
    const fichaIdMap = new Map();

    await dbTransaction(async () => {
      // Insertar partida limpiando totalmente cualquier sufijo
      const nombreLimpio = limpiarNombrePartida(partida.nombre);
      await dbRun(
        `INSERT INTO partidas (id, nombre, codigo, dm_id, escena_activa_id, fecha_creacion, fecha_modificacion, config_grid_x, config_grid_y, config_casilla, imagen_portada, datos_combate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newPartidaId,
          nombreLimpio,
          newCodigo,
          finalDmId,
          null,
          ahora,
          ahora,
          partida.config_grid_x || 40,
          partida.config_grid_y || 40,
          partida.config_casilla || 5,
          partida.imagen_portada || null,
          typeof partida.datos_combate === 'object' ? JSON.stringify(partida.datos_combate) : (partida.datos_combate || null)
        ]
      );

      let firstNewEscenaId = null;
      let targetEscenaActivaId = null;

      // Insertar escenas
      for (const esc of escenas) {
        const newEscenaId = uuidv4();
        escenaIdMap.set(esc.id, newEscenaId);
        if (esc.id === partida.escena_activa_id) {
          targetEscenaActivaId = newEscenaId;
        } else if (!targetEscenaActivaId && esc.mapa) {
          targetEscenaActivaId = newEscenaId;
        }
        if (!firstNewEscenaId) {
          firstNewEscenaId = newEscenaId;
        }
        let finalMapa = esc.mapa || null;
        let rawData = null;
        if (finalMapa && finalMapa.startsWith('data:image/')) {
          rawData = finalMapa;
          finalMapa = await guardarMapaEnDisco(newEscenaId, finalMapa);
        } else if (esc.mapa_data) {
          rawData = esc.mapa_data;
        }
        await dbRun(
          `INSERT INTO escenas (id, partida_id, nombre, mapa, mapa_data, config_grid_x, config_grid_y, config_casilla) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [newEscenaId, newPartidaId, esc.nombre, finalMapa, rawData, esc.config_grid_x || partida.config_grid_x || 40, esc.config_grid_y || partida.config_grid_y || 40, esc.config_casilla || partida.config_casilla || 5]
        );
      }

      // Actualizar escena activa id garantizando que mantenga la escena con mapa
      const finalActivaId = targetEscenaActivaId || firstNewEscenaId;
      if (finalActivaId) {
        await dbRun(`UPDATE partidas SET escena_activa_id = ? WHERE id = ?`, [finalActivaId, newPartidaId]);
      }

      // Insertar fichas
      for (const f of fichas) {
        const newFichaId = uuidv4();
        fichaIdMap.set(f.id, newFichaId);
        const newEscenaId = escenaIdMap.get(f.escena_id) || firstNewEscenaId;
        const hpAct = f.hp_actual !== undefined && f.hp_actual !== null ? f.hp_actual : 10;
        const hpMax = f.hp_maximo !== undefined && f.hp_maximo !== null ? f.hp_maximo : 10;
        const posX = f.x !== undefined && f.x !== null ? f.x : 0;
        const posY = f.y !== undefined && f.y !== null ? f.y : 0;

        await dbRun(
          `INSERT INTO fichas (id, partida_id, escena_id, nombre, tipo, jugador_id, imagen, fuerza, destreza, constitucion, inteligencia, sabiduria, carisma, hp_actual, hp_maximo, ac, velocidad, iniciativa, nivel, altura, tamanio_base, color_aro, gigante, notas, x, y, revelado)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [newFichaId, newPartidaId, newEscenaId, f.nombre, f.tipo || 'jugador', f.jugador_id || null, f.imagen, f.fuerza ?? 10, f.destreza ?? 10, f.constitucion ?? 10, f.inteligencia ?? 10, f.sabiduria ?? 10, f.carisma ?? 10, hpAct, hpMax, f.ac ?? 10, f.velocidad ?? 30, f.iniciativa ?? 0, f.nivel ?? 1, f.altura ?? 2, f.tamanio_base || 'mediano', f.color_aro || '#c9a84c', f.gigante ? 1 : 0, f.notas || '', posX, posY, typeof f.revelado === 'object' ? JSON.stringify(f.revelado) : (f.revelado || 0)]
        );
      }

      // Insertar posiciones_fichas guardadas
      for (const pf of posiciones_fichas) {
        const mappedFichaId = fichaIdMap.get(pf.ficha_id);
        const mappedEscenaId = escenaIdMap.get(pf.escena_id);
        if (mappedFichaId && mappedEscenaId) {
          await dbRun(
            `INSERT OR REPLACE INTO posiciones_fichas (ficha_id, escena_id, x, y) VALUES (?, ?, ?, ?)`,
            [mappedFichaId, mappedEscenaId, pf.x ?? 0, pf.y ?? 0]
          );
        }
      }

      // Insertar figuras
      for (const fig of figuras) {
        const newFigId = uuidv4();
        const newEscenaId = escenaIdMap.get(fig.escena_id) || firstNewEscenaId;
        await dbRun(
          `INSERT INTO figuras (id, escena_id, tipo, x, y, tamanio, ancho, alto, rotacion, color, transparencia, etiqueta, creador_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [newFigId, newEscenaId, fig.tipo, fig.x, fig.y, fig.tamanio, fig.ancho || fig.tamanio || 1, fig.alto || fig.tamanio || 1, fig.rotacion || 0, fig.color, fig.transparencia, fig.etiqueta, fig.creador_id]
        );
      }

      // Insertar dibujos
      for (const d of dibujos) {
        const newDibId = uuidv4();
        const newEscenaId = escenaIdMap.get(d.escena_id) || firstNewEscenaId;
        await dbRun(
          `INSERT INTO dibujos (id, escena_id, datos) VALUES (?, ?, ?)`,
          [newDibId, newEscenaId, typeof d.datos === 'object' ? JSON.stringify(d.datos) : (d.datos || '[]')]
        );
      }

      // Insertar mensajes
      for (const m of mensajes) {
        const newMsgId = uuidv4();
        await dbRun(
          `INSERT INTO mensajes (id, partida_id, usuario_id, nombre_usuario, color_usuario, mensaje, es_gif, fecha)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [newMsgId, newPartidaId, m.usuario_id, m.nombre_usuario, m.color_usuario, m.mensaje, m.es_gif || 0, m.fecha || ahora]
        );
      }

      // Insertar historial dados
      for (const h of historial) {
        const newHistId = uuidv4();
        await dbRun(
          `INSERT INTO historial_dados (id, partida_id, usuario_id, nombre_usuario, formula, tipo, resultado, fecha)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [newHistId, newPartidaId, h.usuario_id, h.nombre_usuario, h.formula, h.tipo, h.resultado, h.fecha || ahora]
        );
      }

      // Insertar galeria
      for (const g of galeria) {
        const newGalId = uuidv4();
        await dbRun(
          `INSERT INTO galeria (id, partida_id, nombre, datos) VALUES (?, ?, ?, ?)`,
          [newGalId, newPartidaId, g.nombre, typeof g.datos === 'object' ? JSON.stringify(g.datos) : g.datos]
        );
      }
    });

    // Guardar inmediatamente la partida importada en archivo JSON independiente y snapshot inicial
    await savePartidaToFile(newPartidaId, true);

    res.json({ success: true, id: newPartidaId, codigo: newCodigo });
  } catch (err) {
    console.error('Error al importar sesión:', err);
    res.status(500).json({ error: err.message });
  }
});

// Cache en memoria para verificación ultrarrápida de propiedad de fichas
const tokenOwnerCache = new Map();

function cacheFichaOwner(ficha) {
  if (ficha && ficha.id) {
    tokenOwnerCache.set(ficha.id, {
      id: ficha.id,
      jugador_id: ficha.jugador_id || null,
      nombre: ficha.nombre || ''
    });
  }
}

function puedeMoverFicha(socket, ficha) {
  if (!ficha) return false;
  if (socket.data?.esDM) return true;
  const usuarioId = (socket.data?.usuarioId || '').toLowerCase().trim();
  const nombreUsuario = (socket.data?.nombreUsuario || '').toLowerCase().trim();
  const fJugadorId = (ficha.jugador_id || '').toLowerCase().trim();
  if (fJugadorId && (fJugadorId === usuarioId || fJugadorId === nombreUsuario || fJugadorId === 'usr_' + nombreUsuario.replace(/[^a-z0-9]/g, '_'))) {
    return true;
  }
  if (ficha.nombre && ficha.nombre.toLowerCase().trim() === nombreUsuario) {
    return true;
  }
  // Si la ficha es de tipo jugador (PJ) y no tiene dueño asignado, cualquier jugador puede controlarla/reclamarla
  const tipoFicha = (ficha.tipo || '').toLowerCase().trim();
  const esPJ = !tipoFicha || tipoFicha === 'jugador' || tipoFicha === 'pj' || tipoFicha === 'personaje';
  if (!fJugadorId && esPJ) {
    return true;
  }
  return false;
}

// --- SOCKET.IO HANDLERS ---

io.on('connection', (socket) => {
  console.log(`🔌 Cliente conectado: ${socket.id}`);

  socket.on('error', (err) => {
    console.warn(`⚠️ [Socket] Error en socket ${socket.id}:`, err?.message || err);
  });

  // Unirse a una partida con código
  socket.on('unirse_partida', async ({ codigo, nombreUsuario, usuarioId, esDMRequested }) => {
    try {
      const partida = await dbGet(`SELECT * FROM partidas WHERE codigo = ?`, [codigo?.toUpperCase()]);
      if (!partida) {
        return socket.emit('error_partida', 'Código de partida inválido o no existe.');
      }
      partida.nombre = limpiarNombrePartida(partida.nombre);

      const effectiveUserId = usuarioId || ('usr_' + (nombreUsuario || 'jugador').toLowerCase().trim().replace(/[^a-z0-9]/g, '_'));

      // Determinar si es DM (comprobación tolerante por ID determinista y nombre de usuario)
      let esDM = false;
      const normalizedDmId = (partida.dm_id || '').toLowerCase().trim();
      const normalizedUserId = (effectiveUserId || '').toLowerCase().trim();
      const normalizedUserName = (nombreUsuario || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '_');

      if (!partida.dm_id) {
        // Fallback por si hay partidas antiguas sin dm_id
        await dbRun(`UPDATE partidas SET dm_id = ? WHERE id = ?`, [effectiveUserId, partida.id]);
        esDM = true;
      } else if (
        normalizedDmId === normalizedUserId ||
        normalizedDmId === ('usr_' + normalizedUserName) ||
        normalizedDmId.replace(/^usr_/, '') === normalizedUserName
      ) {
        esDM = true;
      }

      // Asignar color aleatorio al usuario
      const colorUsuario = COLORES_USUARIOS[Math.floor(Math.random() * COLORES_USUARIOS.length)];

      socket.join(partida.id);
      socket.data = { partidaId: partida.id, usuarioId: effectiveUserId, nombreUsuario, esDM, colorUsuario };

      // Obtener escena activa
      let escenaActiva = await dbGet(`SELECT * FROM escenas WHERE id = ?`, [partida.escena_activa_id]);
      if (!escenaActiva) {
        escenaActiva = await dbGet(`SELECT * FROM escenas WHERE partida_id = ? ORDER BY id ASC LIMIT 1`, [partida.id]);
      }
      if (escenaActiva && partida.escena_activa_id !== escenaActiva.id) {
        await dbRun(`UPDATE partidas SET escena_activa_id = ? WHERE id = ?`, [escenaActiva.id, partida.id]);
        partida.escena_activa_id = escenaActiva.id;
      }
      if (escenaActiva) {
        await verificarMapaEscena(escenaActiva);
      }

      // Obtener listas completas (optimizadas: escenas sin mapa base64 para evitar payloads de 30MB+)
      const escenas = await dbAll(`SELECT id, partida_id, nombre, config_grid_x, config_grid_y, config_casilla FROM escenas WHERE partida_id = ?`, [partida.id]);
      const fichas = await dbAll(`SELECT * FROM fichas WHERE partida_id = ?`, [partida.id]);
      if (escenaActiva) {
        const posiciones = await dbAll(`SELECT * FROM posiciones_fichas WHERE escena_id = ?`, [escenaActiva.id]);
        fichas.forEach(f => {
          cacheFichaOwner(f);
          const pos = posiciones.find(p => p.ficha_id === f.id);
          if (pos) {
            f.x = pos.x;
            f.y = pos.y;
          }
        });
      }
      const figuras = escenaActiva ? await dbAll(`SELECT * FROM figuras WHERE escena_id = ?`, [escenaActiva.id]) : [];
      const dibujoRow = escenaActiva ? await dbGet(`SELECT datos FROM dibujos WHERE escena_id = ?`, [escenaActiva.id]) : null;
      const dibujos = dibujoRow ? JSON.parse(dibujoRow.datos || '[]') : [];
      const props = escenaActiva ? await dbAll(`SELECT * FROM capas_props WHERE escena_id = ?`, [escenaActiva.id]) : [];
      const mensajes = await dbAll(`SELECT * FROM mensajes WHERE partida_id = ? ORDER BY fecha ASC LIMIT 100`, [partida.id]);
      const historial = await dbAll(`SELECT * FROM historial_dados WHERE partida_id = ? ORDER BY fecha DESC LIMIT 100`, [partida.id]);
      const galeria = esDM ? await dbAll(`SELECT * FROM galeria WHERE partida_id = ?`, [partida.id]) : [];

      // Responder con estado inicial
      // Registrar usuario conectado
      if (!connectedUsers.has(partida.id)) {
        connectedUsers.set(partida.id, new Map());
      }
      connectedUsers.get(partida.id).set(effectiveUserId, {
        id: effectiveUserId,
        nombre: nombreUsuario,
        esDM,
        color: colorUsuario,
        socketId: socket.id
      });

      // Preparar lista de jugadores conectados
      const jugadoresConectados = Array.from(connectedUsers.get(partida.id).values());

      // Parsear estado de combate
      let combate = { activo: false, ronda: 1, turnoIndex: 0, participantes: [] };
      if (partida.datos_combate) {
        try {
          combate = JSON.parse(partida.datos_combate);
        } catch (_) { }
      }

      socket.emit('estado_inicial', {
        partida,
        escenaActiva,
        escenas,
        fichas,
        figuras,
        dibujos,
        props,
        mensajes,
        historial,
        galeria,
        combate,
        jugadoresConectados,
        usuario: { id: effectiveUserId, nombre: nombreUsuario, esDM, color: colorUsuario }
      });

      // Emitir lista de jugadores actualizada a toda la sala
      io.to(partida.id).emit('lista_jugadores', jugadoresConectados);

      // Notificar a la sala
      io.to(partida.id).emit('usuario_conectado', {
        id: effectiveUserId,
        nombre: nombreUsuario,
        esDM,
        color: colorUsuario
      });

      // Asegurar que el archivo JSON independiente exista en /data/saves/
      if (partida.codigo) {
        const fs = require('fs');
        const expectedSave = path.join(__dirname, 'data', 'saves', `partida_${partida.codigo.toUpperCase()}.json`);
        if (!fs.existsSync(expectedSave)) {
          savePartidaToFile(partida.id, false).catch(() => { });
        }
      }

    } catch (err) {
      console.error('Error al unirse a la partida:', err);
      socket.emit('error_partida', 'Error en el servidor al cargar la partida.');
    }
  });

  // Cambiar nombre de usuario en caliente durante una sesión activa
  socket.on('cambiar_nombre_usuario', async ({ nuevoNombre }) => {
    try {
      const { partidaId, usuarioId: oldUserId } = socket.data || {};
      if (!partidaId || !nuevoNombre || typeof nuevoNombre !== 'string') return;

      const nombreLimpio = nuevoNombre.trim().substring(0, 40);
      if (!nombreLimpio) return;

      const partida = await dbGet(`SELECT dm_id FROM partidas WHERE id = ?`, [partidaId]);
      const newUserId = 'usr_' + nombreLimpio.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');

      // Si el usuario era DM o su nuevo ID coincide con el dm_id de la partida, conserva/obtiene rol DM
      const eraDM = !!socket.data.esDM;
      const esDM = eraDM || (partida && partida.dm_id === newUserId);

      // Si el usuario era el DM y cambia su nombre, actualizar el dm_id de la partida
      if (eraDM && partida && partida.dm_id === oldUserId) {
        await dbRun(`UPDATE partidas SET dm_id = ? WHERE id = ?`, [newUserId, partidaId]);
      }

      const viejoNombre = socket.data.nombreUsuario || 'Un jugador';
      socket.data.nombreUsuario = nombreLimpio;
      socket.data.usuarioId = newUserId;
      socket.data.esDM = esDM;

      // Actualizar en connectedUsers
      if (connectedUsers.has(partidaId)) {
        const roomUsers = connectedUsers.get(partidaId);
        roomUsers.delete(oldUserId);
        roomUsers.set(newUserId, {
          id: newUserId,
          nombre: nombreLimpio,
          esDM,
          color: socket.data.colorUsuario,
          socketId: socket.id
        });
        io.to(partidaId).emit('lista_jugadores', Array.from(roomUsers.values()));
      }

      // Responder al socket emisor con su nuevo estado
      socket.emit('usuario_actualizado', {
        id: newUserId,
        nombre: nombreLimpio,
        esDM,
        color: socket.data.colorUsuario
      });

      // Anuncio en el chat
      io.to(partidaId).emit('nuevo_mensaje', {
        id: uuidv4(),
        partida_id: partidaId,
        usuario_id: 'sistema',
        nombre_usuario: 'Sistema',
        color_usuario: '#c9a84c',
        mensaje: `👤 "${viejoNombre}" ahora se llama "${nombreLimpio}".`,
        es_gif: 0,
        fecha: new Date().toISOString()
      });
    } catch (err) {
      console.error('Error al cambiar nombre de usuario:', err);
    }
  });

  // Reclamar rol de DM (si el DM original se desconectó, cambió de dispositivo o el host transfirió el mando)
  socket.on('reclamar_dm', async ({ partidaId }) => {
    try {
      const pId = partidaId || socket.data?.partidaId;
      if (!pId) return;

      const partida = await dbGet(`SELECT * FROM partidas WHERE id = ?`, [pId]);
      if (!partida) return;

      const userId = socket.data?.usuarioId;
      const userName = socket.data?.nombreUsuario || 'Dungeon Master';

      // Actualizar en base de datos el nuevo DM
      await dbRun(`UPDATE partidas SET dm_id = ? WHERE id = ?`, [userId, pId]);
      socket.data.esDM = true;

      // Actualizar en memoria el usuario en connectedUsers
      const usersInGame = connectedUsers.get(pId);
      if (usersInGame && usersInGame.has(socket.id)) {
        usersInGame.get(socket.id).esDM = true;
      }

      // Notificar al propio usuario
      socket.emit('usuario_actualizado', { id: userId, nombre: userName, esDM: true });

      // Notificar a toda la sala
      io.to(pId).emit('dm_actualizado', { dm_id: userId, dm_nombre: userName });
      io.to(pId).emit('lista_jugadores', Array.from(usersInGame?.values() || []));

      // Guardar en archivo
      await savePartidaToFile(pId, false);

      io.to(pId).emit('nuevo_mensaje', {
        id: uuidv4(),
        partida_id: pId,
        usuario_id: 'sistema',
        nombre_usuario: 'Sistema',
        color_usuario: '#c9a84c',
        mensaje: `👑 ${userName} ha asumido el rol de Dungeon Master de la partida.`,
        es_gif: 0,
        fecha: new Date().toISOString()
      });
    } catch (err) {
      console.error('Error al reclamar DM:', err);
    }
  });

  // Modificar datos de la sesión en tiempo real (DM / Creador)
  socket.on('actualizar_partida_info', async ({ partidaId, nombre, imagenPortada }) => {
    try {
      if (!socket.data?.esDM) {
        return socket.emit('error_partida', 'Solo el creador o DM puede modificar la sesión.');
      }

      const nombreLimpio = limpiarNombrePartida(nombre);
      const ahora = new Date().toISOString();
      await dbRun(
        `UPDATE partidas SET nombre = ?, imagen_portada = ?, fecha_modificacion = ? WHERE id = ?`,
        [nombreLimpio, imagenPortada || null, ahora, partidaId]
      );

      await savePartidaToFile(partidaId, false);

      io.to(partidaId).emit('partida_actualizada', {
        id: partidaId,
        nombre: nombreLimpio,
        imagen_portada: imagenPortada || null
      });
    } catch (err) {
      console.error('Error en actualizar_partida_info:', err);
    }
  });

  // Cambiar escena (DM)
  socket.on('cambiar_escena', async ({ partidaId, escenaId, escenaAnteriorId, posicionesActuales }) => {
    try {
      const prevPartida = await dbGet(`SELECT escena_activa_id FROM partidas WHERE id = ?`, [partidaId]);
      const prevEscenaId = escenaAnteriorId || prevPartida?.escena_activa_id;

      // 1. Guardar posiciones actuales de las fichas en la escena anterior de forma atómica y ultrarrápida
      if (prevEscenaId && Array.isArray(posicionesActuales) && posicionesActuales.length > 0) {
        await dbTransaction(async () => {
          for (const pos of posicionesActuales) {
            if (pos && pos.fichaId) {
              await dbRun(
                `INSERT OR REPLACE INTO posiciones_fichas (ficha_id, escena_id, x, y) VALUES (?, ?, ?, ?)`,
                [pos.fichaId, prevEscenaId, pos.x ?? 0, pos.y ?? 0]
              );
            }
          }
        });
      }

      // 2. Cambiar escena activa
      await dbRun(`UPDATE partidas SET escena_activa_id = ?, fecha_modificacion = ? WHERE id = ?`, [escenaId, new Date().toISOString(), partidaId]);
      const escenaActiva = await dbGet(`SELECT * FROM escenas WHERE id = ?`, [escenaId]);
      if (escenaActiva) {
        await verificarMapaEscena(escenaActiva);
      }
      const figuras = await dbAll(`SELECT * FROM figuras WHERE escena_id = ?`, [escenaId]);
      const dibujoRow = await dbGet(`SELECT datos FROM dibujos WHERE escena_id = ?`, [escenaId]);
      const dibujos = dibujoRow ? JSON.parse(dibujoRow.datos || '[]') : [];
      const posiciones_fichas = await dbAll(`SELECT * FROM posiciones_fichas WHERE escena_id = ?`, [escenaId]);
      const props = await dbAll(`SELECT * FROM capas_props WHERE escena_id = ?`, [escenaId]);

      // 3. Emitir a la sala
      io.to(partidaId).emit('escena_cambiada', { escenaActiva, figuras, dibujos, posiciones_fichas, props });
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error('Error al cambiar de escena:', err);
    }
  });

  // DM visualiza/prepara una escena en privado sin mover a los jugadores
  socket.on('dm_ver_escena', async ({ partidaId, escenaId }) => {
    try {
      const escena = await dbGet(`SELECT * FROM escenas WHERE id = ?`, [escenaId]);
      if (!escena) return;
      await verificarMapaEscena(escena);
      const figuras = await dbAll(`SELECT * FROM figuras WHERE escena_id = ?`, [escenaId]);
      const dibujoRow = await dbGet(`SELECT datos FROM dibujos WHERE escena_id = ?`, [escenaId]);
      const dibujos = dibujoRow ? JSON.parse(dibujoRow.datos || '[]') : [];
      const posiciones_fichas = await dbAll(`SELECT * FROM posiciones_fichas WHERE escena_id = ?`, [escenaId]);
      const props = await dbAll(`SELECT * FROM capas_props WHERE escena_id = ?`, [escenaId]);
      socket.emit('dm_escena_cargada', { escena, figuras, dibujos, posiciones_fichas, props });
    } catch (err) {
      console.error('Error en dm_ver_escena:', err);
    }
  });

  // Reagrupar todas las fichas de jugadores ordenadamente en la escena activa/actual
  socket.on('reagrupar_fichas', async ({ partidaId, escenaId }) => {
    try {
      if (!socket.data?.esDM) {
        console.warn(`[Seguridad] Usuario '${socket.data?.nombreUsuario}' intentó reagrupar fichas sin permisos de DM.`);
        return;
      }
      const escena = await dbGet(`SELECT * FROM escenas WHERE id = ?`, [escenaId]);
      if (!escena) return;

      // Buscar fichas de jugadores (o con tipo personaje/pj/null/vacío)
      let fichas = await dbAll(
        `SELECT * FROM fichas WHERE partida_id = ? AND (tipo = 'jugador' OR tipo IS NULL OR tipo = '' OR LOWER(tipo) = 'personaje' OR LOWER(tipo) = 'pj')`,
        [partidaId]
      );

      // Primer fallback: si no hay con tipo jugador, buscar todas las fichas que no sean monstruos
      if (!fichas || !fichas.length) {
        fichas = await dbAll(
          `SELECT * FROM fichas WHERE partida_id = ? AND (LOWER(tipo) NOT IN ('monstruo', 'enemigo') OR tipo IS NULL)`,
          [partidaId]
        );
      }

      // Segundo fallback: si no hay ninguna clasificada, reagrupar todas las fichas de la partida
      if (!fichas || !fichas.length) {
        fichas = await dbAll(`SELECT * FROM fichas WHERE partida_id = ?`, [partidaId]);
      }

      if (!fichas || !fichas.length) {
        socket.emit('error_servidor', 'No hay fichas disponibles para reagrupar.');
        return;
      }

      const cols = escena.config_grid_x || 40;
      const rows = escena.config_grid_y || 40;
      const startX = Math.max(1, Math.min(cols - 4, 3));
      const startY = Math.max(1, Math.min(rows - 4, 3));
      const perRow = Math.max(3, Math.floor(Math.sqrt(fichas.length) * 2));

      const updated = [];
      await dbTransaction(async () => {
        for (let i = 0; i < fichas.length; i++) {
          const f = fichas[i];
          const newX = startX + (i % perRow);
          const newY = startY + Math.floor(i / perRow);
          await dbRun(`UPDATE fichas SET x = ?, y = ?, escena_id = ? WHERE id = ?`, [newX, newY, escenaId, f.id]);
          await dbRun(
            `INSERT OR REPLACE INTO posiciones_fichas (ficha_id, escena_id, x, y) VALUES (?, ?, ?, ?)`,
            [f.id, escenaId, newX, newY]
          );
          updated.push({ fichaId: f.id, x: newX, y: newY });
        }
      });

      io.to(partidaId).emit('fichas_reagrupadas', { escenaId, fichas: updated });
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error('Error en reagrupar_fichas:', err);
    }
  });

  // Crear escena (DM)
  socket.on('crear_escena', async ({ partidaId, nombre }) => {
    try {
      const escenaId = uuidv4();
      const p = await dbGet(`SELECT config_grid_x, config_grid_y, config_casilla FROM partidas WHERE id = ?`, [partidaId]);
      await dbRun(`INSERT INTO escenas (id, partida_id, nombre, mapa, config_grid_x, config_grid_y, config_casilla) VALUES (?, ?, ?, ?, ?, ?, ?)`, [escenaId, partidaId, nombre, null, p.config_grid_x, p.config_grid_y, p.config_casilla]);
      const escenas = await dbAll(`SELECT id, partida_id, nombre, config_grid_x, config_grid_y, config_casilla FROM escenas WHERE partida_id = ?`, [partidaId]);
      io.to(partidaId).emit('escenas_actualizadas', escenas);
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error(err);
    }
  });

  // Eliminar escena (DM)
  socket.on('eliminar_escena', async ({ partidaId, escenaId }) => {
    try {
      await eliminarMapaDeDisco(escenaId);
      await dbRun(`DELETE FROM escenas WHERE id = ?`, [escenaId]);
      const escenas = await dbAll(`SELECT id, partida_id, nombre, config_grid_x, config_grid_y, config_casilla FROM escenas WHERE partida_id = ?`, [partidaId]);
      io.to(partidaId).emit('escenas_actualizadas', escenas);
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error(err);
    }
  });

  // Actualizar imagen de mapa de una escena (DM)
  socket.on('actualizar_mapa', async ({ partidaId, escenaId, mapaBase64 }) => {
    try {
      let finalMapa = mapaBase64;
      let rawData = null;
      if (mapaBase64) {
        rawData = mapaBase64;
        // Guardar la imagen en disco y reemplazar el payload pesado por una URL liviana con streaming HTTP
        const urlDisco = await guardarMapaEnDisco(escenaId, mapaBase64);
        if (urlDisco) finalMapa = urlDisco;
      } else {
        await eliminarMapaDeDisco(escenaId);
      }
      await dbRun(`UPDATE escenas SET mapa = ?, mapa_data = ? WHERE id = ?`, [finalMapa, rawData, escenaId]);
      await dbRun(`UPDATE partidas SET fecha_modificacion = ? WHERE id = ?`, [new Date().toISOString(), partidaId]);
      io.to(partidaId).emit('mapa_actualizado', { escenaId, mapa: finalMapa });
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error(err);
    }
  });

  // Actualizar tamaño de Grid (DM)
  socket.on('actualizar_grid', async ({ partidaId, escenaId, gridX, gridY, casilla }) => {
    try {
      await dbRun(
        `UPDATE escenas SET config_grid_x = ?, config_grid_y = ?, config_casilla = ? WHERE id = ?`,
        [gridX, gridY, casilla, escenaId]
      );
      const partida = await dbGet(`SELECT escena_activa_id FROM partidas WHERE id = ?`, [partidaId]);
      if (partida && partida.escena_activa_id === escenaId) {
        await dbRun(
          `UPDATE partidas SET config_grid_x = ?, config_grid_y = ?, config_casilla = ?, fecha_modificacion = ? WHERE id = ?`,
          [gridX, gridY, casilla, new Date().toISOString(), partidaId]
        );
      }
      io.to(partidaId).emit('grid_actualizado', { escenaId, gridX, gridY, casilla });
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error(err);
    }
  });

  // Guardar o actualizar Prop / Objeto de Capa (DM)
  socket.on('guardar_prop', async ({ partidaId, escenaId, propData }) => {
    try {
      const propId = propData.id || uuidv4();
      const {
        nombre = 'Objeto',
        imagen,
        x = 0,
        y = 0,
        ancho = 2,
        alto = 2,
        rotacion = 0,
        capa = 'debajo_fichas',
        bloqueado = 0,
        oculto = 0
      } = propData;

      if (!imagen) return;

      const existe = await dbGet(`SELECT id FROM capas_props WHERE id = ?`, [propId]);
      if (existe) {
        await dbRun(
          `UPDATE capas_props SET escena_id = ?, nombre = ?, imagen = ?, x = ?, y = ?, ancho = ?, alto = ?, rotacion = ?, capa = ?, bloqueado = ?, oculto = ? WHERE id = ?`,
          [escenaId, nombre, imagen, x, y, ancho, alto, rotacion, capa, bloqueado ? 1 : 0, oculto ? 1 : 0, propId]
        );
      } else {
        await dbRun(
          `INSERT INTO capas_props (id, escena_id, nombre, imagen, x, y, ancho, alto, rotacion, capa, bloqueado, oculto)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [propId, escenaId, nombre, imagen, x, y, ancho, alto, rotacion, capa, bloqueado ? 1 : 0, oculto ? 1 : 0]
        );
      }

      const propGuardado = await dbGet(`SELECT * FROM capas_props WHERE id = ?`, [propId]);
      io.to(partidaId).emit('prop_actualizado', { escenaId, prop: propGuardado });
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error('Error en guardar_prop:', err);
    }
  });

  // Mover Prop en tiempo real (Throttled)
  socket.on('mover_prop', ({ partidaId, escenaId, propId, x, y }) => {
    socket.to(partidaId).emit('prop_movido', { escenaId, propId, x, y });
  });

  // Guardar posición final del Prop
  socket.on('guardar_posicion_prop', async ({ partidaId, escenaId, propId, x, y }) => {
    try {
      await dbRun(`UPDATE capas_props SET x = ?, y = ? WHERE id = ?`, [x, y, propId]);
      io.to(partidaId).emit('prop_movido', { escenaId, propId, x, y });
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error('Error en guardar_posicion_prop:', err);
    }
  });

  // Eliminar Prop (DM)
  socket.on('eliminar_prop', async ({ partidaId, escenaId, propId }) => {
    try {
      await dbRun(`DELETE FROM capas_props WHERE id = ?`, [propId]);
      io.to(partidaId).emit('prop_eliminado', { escenaId, propId });
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error('Error en eliminar_prop:', err);
    }
  });

  // Mover ficha en tiempo real (Broadcast ultrarrápido con verificación de dueño y caché)
  socket.on('mover_ficha', async ({ partidaId, escenaId, fichaId, x, y }) => {
    if (!socket.data?.esDM) {
      let ficha = tokenOwnerCache.get(fichaId);
      if (!ficha) {
        ficha = await dbGet(`SELECT id, nombre, tipo, jugador_id FROM fichas WHERE id = ?`, [fichaId]);
        if (ficha) cacheFichaOwner(ficha);
      }
      if (!puedeMoverFicha(socket, ficha)) {
        return;
      }
    }
    socket.to(partidaId).emit('ficha_movida', { fichaId, x, y });
  });

  // Guardar posición final de la ficha en base de datos (al soltar el ratón / touch)
  socket.on('guardar_posicion_ficha', async ({ partidaId, escenaId, fichaId, x, y }) => {
    try {
      if (!socket.data?.esDM) {
        let ficha = tokenOwnerCache.get(fichaId);
        if (!ficha) {
          ficha = await dbGet(`SELECT id, nombre, tipo, jugador_id FROM fichas WHERE id = ?`, [fichaId]);
          if (ficha) cacheFichaOwner(ficha);
        }
        if (!puedeMoverFicha(socket, ficha)) {
          console.warn(`[Seguridad] Usuario '${socket.data?.nombreUsuario}' intentó mover ficha no autorizada '${ficha?.nombre || fichaId}'`);
          return;
        }
      }
      await dbRun(`UPDATE fichas SET x = ?, y = ? WHERE id = ?`, [x, y, fichaId]);
      if (escenaId) {
        await dbRun(`INSERT OR REPLACE INTO posiciones_fichas (ficha_id, escena_id, x, y) VALUES (?, ?, ?, ?)`, [fichaId, escenaId, x, y]);
      }
      io.to(partidaId).emit('ficha_movida', { fichaId, x, y });
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error('Error al guardar posición de ficha:', err);
    }
  });

  // Crear ficha (Jugador / DM)
  socket.on('crear_ficha', async ({ partidaId, escenaId, fichaData, ficha }) => {
    try {
      const id = uuidv4();
      const payload = fichaData || ficha || {};
      const {
        nombre, tipo, jugadorId, jugador_id, imagen, fuerza, destreza, constitucion,
        inteligencia, sabiduria, carisma, hpActual, hp_actual, hpMaximo, hp_maximo, ac, velocidad,
        iniciativa, nivel, altura, tamanioBase, tamanio_base, color_aro, notas, x = 5, y = 5, revelado, efectos
      } = payload;

      const tipoFinal = tipo || 'jugador';
      const rawNombre = (nombre && typeof nombre === 'string') ? nombre.trim() : '';
      const finalNombre = rawNombre || (tipoFinal === 'monstruo' ? 'Monstruo' : 'Personaje');
      const ownerId = jugador_id || jugadorId || (socket.data?.esDM ? (jugador_id || null) : socket.data?.usuarioId);

      const defaultRevelado = JSON.stringify({
        global: { imagen: false, nombre: false, hp: false, ac: false, notas: false },
        jugadores: {}
      });

      const finalRevelado = (revelado !== undefined && revelado !== null && revelado !== 0 && revelado !== '0')
        ? (typeof revelado === 'object' ? JSON.stringify(revelado) : revelado)
        : defaultRevelado;

      const finalEfectos = efectos !== undefined
        ? (typeof efectos === 'object' ? JSON.stringify(efectos) : efectos)
        : '[]';

      await dbRun(
        `INSERT INTO fichas (id, partida_id, escena_id, nombre, tipo, jugador_id, imagen, fuerza, destreza, constitucion, inteligencia, sabiduria, carisma, hp_actual, hp_maximo, ac, velocidad, iniciativa, nivel, altura, tamanio_base, color_aro, notas, x, y, revelado, efectos)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, partidaId, escenaId, finalNombre, tipoFinal, ownerId, imagen, fuerza || 10, destreza || 10, constitucion || 10, inteligencia || 10, sabiduria || 10, carisma || 10, hpActual ?? hp_actual ?? 10, hpMaximo ?? hp_maximo ?? 10, ac ?? 10, velocidad ?? 30, iniciativa ?? 0, nivel ?? 1, altura ?? 2, tamanioBase || tamanio_base || 'mediano', color_aro || '#c9a84c', notas || '', x, y, finalRevelado, finalEfectos]
      );

      if (escenaId) {
        await dbRun(
          `INSERT OR REPLACE INTO posiciones_fichas (ficha_id, escena_id, x, y) VALUES (?, ?, ?, ?)`,
          [id, escenaId, x, y]
        );
      }

      const nuevaFicha = await dbGet(`SELECT * FROM fichas WHERE id = ?`, [id]);
      cacheFichaOwner(nuevaFicha);
      io.to(partidaId).emit('ficha_creada', nuevaFicha);
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error(err);
    }
  });

  // Actualizar ficha (preservando revelado, gigante y oculto si no se envían)
  socket.on('actualizar_ficha', async ({ partidaId, fichaData }) => {
    try {
      if (!fichaData || !fichaData.id) return;
      const current = await dbGet(`SELECT * FROM fichas WHERE id = ?`, [fichaData.id]);
      if (!current) return;

      // Verificación de seguridad: si no es DM, sólo puede actualizar si es el dueño
      if (!socket.data?.esDM && !puedeMoverFicha(socket, current)) {
        console.warn(`[Seguridad] Usuario '${socket.data?.nombreUsuario}' no autorizado para actualizar ficha '${current.nombre}'`);
        return;
      }

      const {
        id,
        nombre,
        tipo = current.tipo,
        jugador_id,
        jugadorId,
        imagen = current.imagen,
        fuerza = current.fuerza,
        destreza = current.destreza,
        constitucion = current.constitucion,
        inteligencia = current.inteligencia,
        sabiduria = current.sabiduria,
        carisma = current.carisma,
        hp_actual = (fichaData.hpActual !== undefined ? fichaData.hpActual : current.hp_actual),
        hp_maximo = (fichaData.hpMaximo !== undefined ? fichaData.hpMaximo : current.hp_maximo),
        ac = current.ac,
        velocidad = current.velocidad,
        iniciativa = current.iniciativa,
        nivel = current.nivel,
        altura = current.altura,
        tamanio_base = (fichaData.tamanioBase || current.tamanio_base),
        color_aro = current.color_aro,
        gigante,
        notas = current.notas,
        revelado,
        oculto,
        efectos
      } = fichaData;

      // Sanitizar nombre para evitar que un string vacío o con espacios borre el nombre actual
      const cleanNombre = (nombre !== undefined && typeof nombre === 'string') ? nombre.trim() : current.nombre;
      const finalNombre = cleanNombre || current.nombre || (current.tipo === 'monstruo' ? 'Monstruo' : 'Personaje');

      // Si no es DM y la ficha es un PJ sin dueño asignado, el jugador que la edita la reclama
      const tipoLower = (current.tipo || '').toLowerCase().trim();
      const esPJ = !tipoLower || tipoLower === 'jugador' || tipoLower === 'pj' || tipoLower === 'personaje';
      let finalJugadorId = current.jugador_id;
      if (socket.data?.esDM) {
        finalJugadorId = (jugador_id !== undefined ? jugador_id : (jugadorId !== undefined ? jugadorId : current.jugador_id));
      } else if (!current.jugador_id && esPJ && socket.data?.usuarioId) {
        finalJugadorId = socket.data?.usuarioId;
      }

      const finalRevelado = revelado !== undefined
        ? (typeof revelado === 'object' ? JSON.stringify(revelado) : revelado)
        : current.revelado;
      const finalGigante = gigante !== undefined ? (gigante ? 1 : 0) : current.gigante;
      const finalOculto = oculto !== undefined ? (oculto ? 1 : 0) : current.oculto;
      const finalEfectos = efectos !== undefined
        ? (typeof efectos === 'object' ? JSON.stringify(efectos) : efectos)
        : (current.efectos || '[]');

      await dbRun(
        `UPDATE fichas SET nombre = ?, tipo = ?, jugador_id = ?, imagen = ?, fuerza = ?, destreza = ?, constitucion = ?, inteligencia = ?, sabiduria = ?, carisma = ?, hp_actual = ?, hp_maximo = ?, ac = ?, velocidad = ?, iniciativa = ?, nivel = ?, altura = ?, tamanio_base = ?, color_aro = ?, gigante = ?, notas = ?, revelado = ?, oculto = ?, efectos = ? WHERE id = ?`,
        [finalNombre, tipo, finalJugadorId, imagen, fuerza, destreza, constitucion, inteligencia, sabiduria, carisma, hp_actual, hp_maximo, ac, velocidad, iniciativa, nivel, altura, tamanio_base, color_aro || '#c9a84c', finalGigante, notas, finalRevelado, finalOculto, finalEfectos, id]
      );

      const fichaActualizada = await dbGet(`SELECT * FROM fichas WHERE id = ?`, [id]);
      cacheFichaOwner(fichaActualizada);
      io.to(partidaId).emit('ficha_actualizada', fichaActualizada);
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error(err);
    }
  });

  // --- GESTIÓN DE EFECTOS Y CONDICIONES VISUALES (ALPHA) ---
  // Asignar efecto a una ficha
  socket.on('asignar_efecto_ficha', async ({ partidaId, fichaId, efecto }) => {
    try {
      if (!fichaId || !efecto || !efecto.nombre) return;
      const ficha = await dbGet(`SELECT * FROM fichas WHERE id = ?`, [fichaId]);
      if (!ficha) return;

      // Verificación de seguridad: DM o dueño de la ficha
      if (!socket.data?.esDM && !puedeMoverFicha(socket, ficha)) {
        return socket.emit('error_partida', 'No tienes permiso para modificar los efectos de esta ficha.');
      }

      let efectos = [];
      try { efectos = JSON.parse(ficha.efectos || '[]'); } catch (_) { efectos = []; }

      // Generar o normalizar ID del efecto
      const efectoId = efecto.id || ('ef_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));
      const efectoNorm = {
        id: efectoId,
        nombre: efecto.nombre.trim(),
        icono: efecto.icono || '✨',
        imagen: efecto.imagen || '',
        color: efecto.color || '#c9a84c',
        descripcion: efecto.descripcion || '',
        ajusteDado: efecto.ajusteDado || 'ninguno',
        tipoDado: efecto.tipoDado || 'todos',
        duracion: efecto.duracion || 'Indefinida',
        origen: efecto.origen || (socket.data?.esDM ? 'dm' : 'jugador'),
        fechaCreacion: Date.now()
      };

      // Si ya existía por id o por nombre exacto, reemplazarlo; si no, agregarlo
      const existingIdx = efectos.findIndex(e => e.id === efectoNorm.id || e.nombre.toLowerCase() === efectoNorm.nombre.toLowerCase());
      if (existingIdx !== -1) {
        efectos[existingIdx] = efectoNorm;
      } else {
        efectos.push(efectoNorm);
      }

      const jsonEfectos = JSON.stringify(efectos);
      await dbRun(`UPDATE fichas SET efectos = ? WHERE id = ?`, [jsonEfectos, fichaId]);

      ficha.efectos = jsonEfectos;
      cacheFichaOwner(ficha);
      io.to(partidaId).emit('ficha_actualizada', ficha);
      scheduleAutoSave(partidaId);

      // Notificar al chat sobre la condición aplicada y la regla para los jugadores
      let mensajeChat = `✨ "${ficha.nombre}" ahora tiene el efecto: ${efectoNorm.icono} ${efectoNorm.nombre}.`;
      if (efectoNorm.descripcion) {
        mensajeChat += ` Regla: ${efectoNorm.descripcion}`;
      }
      if (efectoNorm.ajusteDado && efectoNorm.ajusteDado !== 'ninguno') {
        mensajeChat += ` [Efecto en dados: ${efectoNorm.ajusteDado.toUpperCase()}]`;
      }

      io.to(partidaId).emit('nuevo_mensaje', {
        id: uuidv4(),
        partida_id: partidaId,
        usuario_id: 'sistema',
        nombre_usuario: 'Efectos [ALPHA]',
        color_usuario: efectoNorm.color || '#c9a84c',
        mensaje: mensajeChat,
        es_gif: 0,
        fecha: new Date().toISOString(),
        nombre_ficha: ficha.nombre
      });
    } catch (err) {
      console.error('Error en asignar_efecto_ficha:', err);
    }
  });

  // Remover efecto de una ficha
  socket.on('remover_efecto_ficha', async ({ partidaId, fichaId, efectoId }) => {
    try {
      if (!fichaId || !efectoId) return;
      const ficha = await dbGet(`SELECT * FROM fichas WHERE id = ?`, [fichaId]);
      if (!ficha) return;

      if (!socket.data?.esDM && !puedeMoverFicha(socket, ficha)) {
        return socket.emit('error_partida', 'No tienes permiso para remover efectos de esta ficha.');
      }

      let efectos = [];
      try { efectos = JSON.parse(ficha.efectos || '[]'); } catch (_) { efectos = []; }

      const efectoAEliminar = efectos.find(e => e.id === efectoId);
      efectos = efectos.filter(e => e.id !== efectoId);

      const jsonEfectos = JSON.stringify(efectos);
      await dbRun(`UPDATE fichas SET efectos = ? WHERE id = ?`, [jsonEfectos, fichaId]);

      ficha.efectos = jsonEfectos;
      cacheFichaOwner(ficha);
      io.to(partidaId).emit('ficha_actualizada', ficha);
      scheduleAutoSave(partidaId);

      if (efectoAEliminar) {
        io.to(partidaId).emit('nuevo_mensaje', {
          id: uuidv4(),
          partida_id: partidaId,
          usuario_id: 'sistema',
          nombre_usuario: 'Efectos [ALPHA]',
          color_usuario: '#94a3b8',
          mensaje: `💨 "${ficha.nombre}" ya no tiene el efecto: ${efectoAEliminar.icono || '✨'} ${efectoAEliminar.nombre}.`,
          es_gif: 0,
          fecha: new Date().toISOString(),
          nombre_ficha: ficha.nombre
        });
      }
    } catch (err) {
      console.error('Error en remover_efecto_ficha:', err);
    }
  });

  // Guardar efecto en catálogo personalizado de la partida (solo DM)
  socket.on('guardar_efecto_catalogo', async ({ partidaId, efecto }) => {
    try {
      if (!socket.data?.esDM) {
        return socket.emit('error_partida', 'Solo el Dungeon Master puede modificar el catálogo de efectos.');
      }
      if (!partidaId || !efecto || !efecto.nombre) return;

      const partida = await dbGet(`SELECT efectos_catalogo FROM partidas WHERE id = ?`, [partidaId]);
      if (!partida) return;

      let catalogo = [];
      try { catalogo = JSON.parse(partida.efectos_catalogo || '[]'); } catch (_) { catalogo = []; }

      const id = efecto.id || ('cust_ef_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));
      const nuevo = {
        id,
        nombre: efecto.nombre.trim(),
        icono: efecto.icono || '✨',
        imagen: efecto.imagen || '',
        color: efecto.color || '#c9a84c',
        descripcion: efecto.descripcion || '',
        ajusteDado: efecto.ajusteDado || 'ninguno',
        tipoDado: efecto.tipoDado || 'todos',
        duracion: efecto.duracion || 'Indefinida',
        origen: 'custom'
      };

      const existIdx = catalogo.findIndex(e => e.id === id || e.nombre.toLowerCase() === nuevo.nombre.toLowerCase());
      if (existIdx !== -1) catalogo[existIdx] = nuevo;
      else catalogo.push(nuevo);

      const jsonCat = JSON.stringify(catalogo);
      await dbRun(`UPDATE partidas SET efectos_catalogo = ? WHERE id = ?`, [jsonCat, partidaId]);

      io.to(partidaId).emit('catalogo_efectos_actualizado', catalogo);
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error('Error en guardar_efecto_catalogo:', err);
    }
  });

  // Eliminar efecto del catálogo personalizado de la partida (solo DM)
  socket.on('eliminar_efecto_catalogo', async ({ partidaId, efectoId }) => {
    try {
      if (!socket.data?.esDM) return;
      if (!partidaId || !efectoId) return;

      const partida = await dbGet(`SELECT efectos_catalogo FROM partidas WHERE id = ?`, [partidaId]);
      if (!partida) return;

      let catalogo = [];
      try { catalogo = JSON.parse(partida.efectos_catalogo || '[]'); } catch (_) { catalogo = []; }
      catalogo = catalogo.filter(e => e.id !== efectoId);

      const jsonCat = JSON.stringify(catalogo);
      await dbRun(`UPDATE partidas SET efectos_catalogo = ? WHERE id = ?`, [jsonCat, partidaId]);

      io.to(partidaId).emit('catalogo_efectos_actualizado', catalogo);
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error('Error en eliminar_efecto_catalogo:', err);
    }
  });

  // Toggle Forma de Gigante
  socket.on('toggle_gigante', async ({ partidaId, fichaId }) => {
    try {
      const ficha = await dbGet(`SELECT gigante FROM fichas WHERE id = ?`, [fichaId]);
      if (ficha) {
        const nuevoEstado = ficha.gigante ? 0 : 1;
        await dbRun(`UPDATE fichas SET gigante = ? WHERE id = ?`, [nuevoEstado, fichaId]);
        io.to(partidaId).emit('gigante_toggled', { fichaId, gigante: nuevoEstado });
        scheduleAutoSave(partidaId);
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Toggle Ocultar Ficha (DM)
  socket.on('toggle_oculto', async ({ partidaId, fichaId }) => {
    try {
      const ficha = await dbGet(`SELECT oculto FROM fichas WHERE id = ?`, [fichaId]);
      if (ficha) {
        const nuevoEstado = ficha.oculto ? 0 : 1;
        await dbRun(`UPDATE fichas SET oculto = ? WHERE id = ?`, [nuevoEstado, fichaId]);
        io.to(partidaId).emit('oculto_toggled', { fichaId, oculto: nuevoEstado });
        scheduleAutoSave(partidaId);
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Actualizar Configuración de Revelado
  socket.on('actualizar_config_revelado', async ({ partidaId, fichaId, config }) => {
    try {
      const ficha = await dbGet(`SELECT id FROM fichas WHERE id = ?`, [fichaId]);
      if (ficha) {
        await dbRun(`UPDATE fichas SET revelado = ? WHERE id = ?`, [JSON.stringify(config), fichaId]);
        io.to(partidaId).emit('revelado_toggled', { fichaId, revelado: JSON.stringify(config) });
        scheduleAutoSave(partidaId);
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Eliminar ficha (DM o dueño legítimo de la ficha)
  socket.on('eliminar_ficha', async ({ partidaId, fichaId }) => {
    try {
      const ficha = await dbGet(`SELECT * FROM fichas WHERE id = ?`, [fichaId]);
      if (!ficha) return;

      const esDM = socket.data?.esDM;
      const usuarioId = (socket.data?.usuarioId || '').toLowerCase().trim();
      const nombreUsuario = (socket.data?.nombreUsuario || '').toLowerCase().trim();
      const fJugadorId = (ficha.jugador_id || '').toLowerCase().trim();

      // Permitir eliminación si el usuario es DM o dueño asignado de la ficha
      const esDuenio = esDM ||
        (fJugadorId && (fJugadorId === usuarioId || fJugadorId === nombreUsuario || fJugadorId === 'usr_' + nombreUsuario.replace(/[^a-z0-9]/g, '_'))) ||
        (ficha.nombre && ficha.nombre.toLowerCase().trim() === nombreUsuario);

      if (!esDuenio) {
        console.warn(`[Seguridad] Usuario '${socket.data?.nombreUsuario}' no autorizado para eliminar ficha '${ficha.nombre}'`);
        return;
      }

      await dbRun(`DELETE FROM fichas WHERE id = ?`, [fichaId]);
      await dbRun(`DELETE FROM posiciones_fichas WHERE ficha_id = ?`, [fichaId]);
      tokenOwnerCache.delete(fichaId);
      io.to(partidaId).emit('ficha_eliminada', fichaId);
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error(err);
    }
  });

  // Aplicar Daño / Curación a ficha
  socket.on('aplicar_dano_curacion', async ({ partidaId, fichaId, cantidad, esCuracion }) => {
    try {
      const ficha = await dbGet(`SELECT hp_actual, hp_maximo FROM fichas WHERE id = ?`, [fichaId]);
      if (ficha) {
        let nuevoHp = esCuracion ? ficha.hp_actual + cantidad : ficha.hp_actual - cantidad;
        if (nuevoHp > ficha.hp_maximo) nuevoHp = ficha.hp_maximo;
        if (nuevoHp < 0) nuevoHp = 0;

        await dbRun(`UPDATE fichas SET hp_actual = ? WHERE id = ?`, [nuevoHp, fichaId]);
        io.to(partidaId).emit('hp_actualizado', { fichaId, hp_actual: nuevoHp, hp_maximo: ficha.hp_maximo, cambio: cantidad, esCuracion });
        scheduleAutoSave(partidaId);
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Guardar figura geométrica
  socket.on('guardar_figura', async ({ partidaId, escenaId, figuraData }) => {
    try {
      const id = figuraData.id || uuidv4();
      const { tipo, x, y, tamanio, ancho, alto, rotacion, color, transparencia, etiqueta, creador_id } = figuraData;
      const finalAncho = ancho !== undefined ? parseFloat(ancho) : (parseFloat(tamanio) || 1);
      const finalAlto = alto !== undefined ? parseFloat(alto) : (parseFloat(tamanio) || 1);
      const finalTamanio = tamanio !== undefined ? parseFloat(tamanio) : finalAncho;

      await dbRun(
        `INSERT INTO figuras (id, escena_id, tipo, x, y, tamanio, ancho, alto, rotacion, color, transparencia, etiqueta, creador_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET tipo=excluded.tipo, x=excluded.x, y=excluded.y, tamanio=excluded.tamanio, ancho=excluded.ancho, alto=excluded.alto, rotacion=excluded.rotacion, color=excluded.color, transparencia=excluded.transparencia, etiqueta=excluded.etiqueta, creador_id=excluded.creador_id`,
        [id, escenaId, tipo, x, y, finalTamanio, finalAncho, finalAlto, rotacion || 0, color, transparencia, etiqueta, creador_id]
      );

      const figuras = await dbAll(`SELECT * FROM figuras WHERE escena_id = ?`, [escenaId]);
      io.to(partidaId).emit('figuras_actualizadas', figuras);
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error(err);
    }
  });

  // Eliminar figura geométrica
  socket.on('eliminar_figura', async ({ partidaId, escenaId, figuraId }) => {
    try {
      await dbRun(`DELETE FROM figuras WHERE id = ?`, [figuraId]);
      const figuras = await dbAll(`SELECT * FROM figuras WHERE escena_id = ?`, [escenaId]);
      io.to(partidaId).emit('figuras_actualizadas', figuras);
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error(err);
    }
  });

  // Limpiar todas las figuras (solo DM)
  socket.on('limpiar_figuras', async ({ partidaId, escenaId }) => {
    try {
      // Validar que solo el DM pueda borrar todas las figuras
      if (!socket.data?.esDM) {
        // Si no es DM, solo borrar sus propias figuras (fallback de seguridad)
        await dbRun(`DELETE FROM figuras WHERE escena_id = ? AND creador_id = ?`, [escenaId, socket.data?.usuarioId]);
      } else {
        await dbRun(`DELETE FROM figuras WHERE escena_id = ?`, [escenaId]);
      }
      const figuras = await dbAll(`SELECT * FROM figuras WHERE escena_id = ?`, [escenaId]);
      io.to(partidaId).emit('figuras_actualizadas', figuras);
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error(err);
    }
  });

  // Limpiar solo mis figuras (Jugadores)
  socket.on('limpiar_mis_figuras', async ({ partidaId, escenaId, usuarioId }) => {
    try {
      await dbRun(`DELETE FROM figuras WHERE escena_id = ? AND creador_id = ?`, [escenaId, usuarioId]);
      const figuras = await dbAll(`SELECT * FROM figuras WHERE escena_id = ?`, [escenaId]);
      io.to(partidaId).emit('figuras_actualizadas', figuras);
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error(err);
    }
  });

  // Guardar trazos de dibujo
  socket.on('guardar_dibujos', async ({ partidaId, escenaId, datos }) => {
    try {
      const datosJson = JSON.stringify(datos);
      const id = uuidv4();
      await dbRun(
        `INSERT INTO dibujos (id, escena_id, datos) VALUES (?, ?, ?)
         ON CONFLICT(escena_id) DO UPDATE SET datos = excluded.datos`,
        [id, escenaId, datosJson]
      );
      io.to(partidaId).emit('dibujos_actualizados', datos);
      io.to(partidaId).emit('dibujos_actualizadas', datos);
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error(err);
    }
  });

  // Limpiar dibujos
  socket.on('limpiar_dibujos', async ({ partidaId, escenaId }) => {
    try {
      await dbRun(`DELETE FROM dibujos WHERE escena_id = ?`, [escenaId]);
      io.to(partidaId).emit('dibujos_actualizados', []);
      io.to(partidaId).emit('dibujos_actualizadas', []);
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error(err);
    }
  });

  // Enviar mensaje al Chat (Texto o GIF)
  socket.on('enviar_mensaje', async ({ partidaId, usuarioId, nombreUsuario, colorUsuario, mensaje, esGif }) => {
    try {
      const id = uuidv4();
      const fecha = new Date().toISOString();

      await dbRun(
        `INSERT INTO mensajes (id, partida_id, usuario_id, nombre_usuario, color_usuario, mensaje, es_gif, fecha)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, partidaId, usuarioId, nombreUsuario, colorUsuario, mensaje, esGif ? 1 : 0, fecha]
      );

      const nuevoMensaje = { id, partida_id: partidaId, usuario_id: usuarioId, nombre_usuario: nombreUsuario, color_usuario: colorUsuario, mensaje, es_gif: esGif ? 1 : 0, fecha };
      io.to(partidaId).emit('nuevo_mensaje', nuevoMensaje);
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error(err);
    }
  });

  // Lanzar dados e insertar en historial
  socket.on('lanzar_dados', async ({ partidaId, usuarioId, nombreUsuario, formula, tipo, resultado, fichaId, fichaNombre, icono }) => {
    try {
      const id = uuidv4();
      const fecha = new Date().toISOString();

      let nombreFichaFinal = (fichaNombre || '').trim() || null;
      if (!nombreFichaFinal && fichaId) {
        const fRow = await dbGet(`SELECT nombre FROM fichas WHERE id = ?`, [fichaId]);
        if (fRow && fRow.nombre) nombreFichaFinal = fRow.nombre;
      }

      await dbRun(
        `INSERT INTO historial_dados (id, partida_id, usuario_id, nombre_usuario, formula, tipo, resultado, fecha, nombre_ficha)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, partidaId, usuarioId, nombreUsuario, formula, tipo, resultado, fecha, nombreFichaFinal]
      );

      const nuevoRegistro = { id, partida_id: partidaId, usuario_id: usuarioId, nombre_usuario: nombreUsuario, formula, tipo, resultado, fecha, nombre_ficha: nombreFichaFinal };
      io.to(partidaId).emit('nueva_tirada', nuevoRegistro);

      // Emitir mensaje en chat
      const msgId = uuidv4();
      const fichaTag = nombreFichaFinal ? ` [🎯 ${nombreFichaFinal}]` : '';
      const mensajeTexto = `🎲 ha lanzado ${formula} para [${tipo}] y ha sacado **${resultado}**${fichaTag}`;
      await dbRun(
        `INSERT INTO mensajes (id, partida_id, usuario_id, nombre_usuario, color_usuario, mensaje, es_gif, fecha, nombre_ficha)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [msgId, partidaId, usuarioId, nombreUsuario, socket.data?.colorUsuario || '#c9a84c', mensajeTexto, fecha, nombreFichaFinal]
      );

      io.to(partidaId).emit('nuevo_mensaje', {
        id: msgId,
        partida_id: partidaId,
        usuario_id: usuarioId,
        nombre_usuario: nombreUsuario,
        color_usuario: socket.data?.colorUsuario || '#c9a84c',
        mensaje: mensajeTexto,
        es_gif: 0,
        fecha,
        nombre_ficha: nombreFichaFinal
      });

      // Si se especificó una ficha, emitir animación sobre la ficha en el mapa
      if (fichaId) {
        io.to(partidaId).emit('animacion_dado_ficha', { fichaId, icono: icono || '🎲', resultado });
      }
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error(err);
    }
  });

  // Limpiar historial de dados (DM)
  socket.on('limpiar_historial', async ({ partidaId }) => {
    try {
      await dbRun(`DELETE FROM historial_dados WHERE partida_id = ?`, [partidaId]);
      io.to(partidaId).emit('historial_limpiado');
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error(err);
    }
  });

  // Guardar ficha en Galería de DM
  socket.on('guardar_galeria', async ({ partidaId, nombre, datos }) => {
    try {
      const id = uuidv4();
      const datosJson = typeof datos === 'object' ? JSON.stringify(datos) : datos;
      await dbRun(`INSERT INTO galeria (id, partida_id, nombre, datos) VALUES (?, ?, ?, ?)`, [id, partidaId, nombre, datosJson]);
      const galeria = await dbAll(`SELECT * FROM galeria WHERE partida_id = ?`, [partidaId]);
      io.to(partidaId).emit('galeria_actualizada', galeria);
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error(err);
    }
  });

  // Eliminar elemento de la Galería DM
  socket.on('eliminar_galeria', async ({ partidaId, galeriaId }) => {
    try {
      await dbRun(`DELETE FROM galeria WHERE id = ?`, [galeriaId]);
      const galeria = await dbAll(`SELECT * FROM galeria WHERE partida_id = ?`, [partidaId]);
      io.to(partidaId).emit('galeria_actualizada', galeria);
      scheduleAutoSave(partidaId);
    } catch (err) {
      console.error(err);
    }
  });

  // Guardado automático periódico (guarda en DB y en archivo independiente)
  socket.on('guardado_automatico', async ({ partidaId }) => {
    try {
      await dbRun(`UPDATE partidas SET fecha_modificacion = ? WHERE id = ?`, [new Date().toISOString(), partidaId]);
      await savePartidaToFile(partidaId, false);
      socket.emit('guardado_confirmado', { exito: true, fecha: new Date().toISOString() });
    } catch (err) {
      console.error(err);
    }
  });

  // Guardado forzado manual (ej: Ctrl+S o botón de guardar ahora)
  socket.on('forzar_guardado', async ({ partidaId }) => {
    try {
      await dbRun(`UPDATE partidas SET fecha_modificacion = ? WHERE id = ?`, [new Date().toISOString(), partidaId]);
      const ok = await savePartidaToFile(partidaId, true); // true = crea snapshot
      socket.emit('guardado_confirmado', { exito: ok, fecha: new Date().toISOString(), snapshot: true });
    } catch (err) {
      console.error(err);
    }
  });

  // Toggle DM status (DM only)
  socket.on('toggle_dm', async ({ partidaId, targetUsuarioId, makeDM }) => {
    try {
      if (!socket.data?.esDM) return; // Only current DMs can grant/revoke DM

      const pUsers = connectedUsers.get(partidaId);
      if (pUsers && pUsers.has(targetUsuarioId)) {
        const targetUser = pUsers.get(targetUsuarioId);
        targetUser.esDM = makeDM;

        // Notify the specific user to update their UI
        io.to(targetUser.socketId).emit('update_dm_status', { esDM: makeDM });

        // Update the full list for everyone
        const jugadoresConectados = Array.from(pUsers.values());
        io.to(partidaId).emit('lista_jugadores', jugadoresConectados);
      }
    } catch (err) {
      console.error(err);
    }
  });

  // --- COMBAT / INITIATIVE TRACKER EVENTS ---

  // Iniciar Combate (DM)
  socket.on('iniciar_combate', async ({ partidaId, participantes }) => {
    try {
      if (!socket.data?.esDM) {
        return socket.emit('error_partida', 'Solo el DM puede iniciar el combate.');
      }

      // Ordenar por iniciativa de mayor a menor
      const ordenados = (participantes || []).slice().sort((a, b) => {
        const iniA = Number(a.iniciativa) || 0;
        const iniB = Number(b.iniciativa) || 0;
        if (iniB !== iniA) return iniB - iniA;
        const desA = Number(a.destreza) || 10;
        const desB = Number(b.destreza) || 10;
        return desB - desA;
      });

      const combate = {
        activo: true,
        ronda: 1,
        turnoIndex: 0,
        participantes: ordenados
      };

      const ahora = new Date().toISOString();
      await dbRun(`UPDATE partidas SET datos_combate = ?, fecha_modificacion = ? WHERE id = ?`, [JSON.stringify(combate), ahora, partidaId]);
      scheduleAutoSave(partidaId);

      io.to(partidaId).emit('combate_actualizado', combate);

      // Mensaje en chat de sistema
      const primerTurno = ordenados[0]?.nombre || 'Nadie';
      const mensajeTexto = `⚔️ **¡Ha comenzado el combate!** (Ronda 1) — Turno de: **${primerTurno}**`;
      const msgId = uuidv4();
      await dbRun(
        `INSERT INTO mensajes (id, partida_id, usuario_id, nombre_usuario, color_usuario, mensaje, es_gif, fecha, nombre_ficha)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [msgId, partidaId, 'sistema', 'Sistema', '#c9a84c', mensajeTexto, 0, ahora, null]
      );
      io.to(partidaId).emit('nuevo_mensaje', {
        id: msgId,
        partida_id: partidaId,
        usuario_id: 'sistema',
        nombre_usuario: 'Sistema',
        color_usuario: '#c9a84c',
        mensaje: mensajeTexto,
        es_gif: 0,
        fecha: ahora,
        nombre_ficha: null
      });
    } catch (err) {
      console.error('[Combate] Error en iniciar_combate:', err);
    }
  });

  // Siguiente Turno (DM o jugador del turno actual)
  socket.on('siguiente_turno', async ({ partidaId }) => {
    try {
      const partida = await dbGet(`SELECT datos_combate FROM partidas WHERE id = ?`, [partidaId]);
      if (!partida || !partida.datos_combate) return;

      let combate = JSON.parse(partida.datos_combate);
      if (!combate || !combate.activo || !combate.participantes || combate.participantes.length === 0) return;

      const turnoActual = combate.participantes[combate.turnoIndex];
      const esDuenio = turnoActual && socket.data?.usuarioId && (turnoActual.jugador_id === socket.data.usuarioId);
      if (!socket.data?.esDM && !esDuenio) {
        return socket.emit('error_partida', 'Solo el DM o el jugador en turno puede avanzar el combate.');
      }

      let nuevaRonda = combate.ronda || 1;
      let nuevoTurnoIndex = (combate.turnoIndex || 0) + 1;

      if (nuevoTurnoIndex >= combate.participantes.length) {
        nuevoTurnoIndex = 0;
        nuevaRonda += 1;
      }

      combate.ronda = nuevaRonda;
      combate.turnoIndex = nuevoTurnoIndex;

      const ahora = new Date().toISOString();
      await dbRun(`UPDATE partidas SET datos_combate = ?, fecha_modificacion = ? WHERE id = ?`, [JSON.stringify(combate), ahora, partidaId]);
      scheduleAutoSave(partidaId);

      io.to(partidaId).emit('combate_actualizado', combate);

      const siguienteNombre = combate.participantes[nuevoTurnoIndex]?.nombre || 'Desconocido';
      const mensajeTexto = `⚔️ Ronda ${nuevaRonda}: Turno de **${siguienteNombre}**`;
      const msgId = uuidv4();
      await dbRun(
        `INSERT INTO mensajes (id, partida_id, usuario_id, nombre_usuario, color_usuario, mensaje, es_gif, fecha, nombre_ficha)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [msgId, partidaId, 'sistema', 'Sistema', '#c9a84c', mensajeTexto, 0, ahora, null]
      );
      io.to(partidaId).emit('nuevo_mensaje', {
        id: msgId,
        partida_id: partidaId,
        usuario_id: 'sistema',
        nombre_usuario: 'Sistema',
        color_usuario: '#c9a84c',
        mensaje: mensajeTexto,
        es_gif: 0,
        fecha: ahora,
        nombre_ficha: null
      });
    } catch (err) {
      console.error('[Combate] Error en siguiente_turno:', err);
    }
  });

  // Turno Anterior (DM)
  socket.on('anterior_turno', async ({ partidaId }) => {
    try {
      if (!socket.data?.esDM) {
        return socket.emit('error_partida', 'Solo el DM puede retroceder el turno.');
      }

      const partida = await dbGet(`SELECT datos_combate FROM partidas WHERE id = ?`, [partidaId]);
      if (!partida || !partida.datos_combate) return;

      let combate = JSON.parse(partida.datos_combate);
      if (!combate || !combate.activo || !combate.participantes || combate.participantes.length === 0) return;

      let nuevaRonda = combate.ronda || 1;
      let nuevoTurnoIndex = (combate.turnoIndex || 0) - 1;

      if (nuevoTurnoIndex < 0) {
        if (nuevaRonda > 1) {
          nuevaRonda -= 1;
          nuevoTurnoIndex = combate.participantes.length - 1;
        } else {
          nuevoTurnoIndex = 0;
        }
      }

      combate.ronda = nuevaRonda;
      combate.turnoIndex = nuevoTurnoIndex;

      const ahora = new Date().toISOString();
      await dbRun(`UPDATE partidas SET datos_combate = ?, fecha_modificacion = ? WHERE id = ?`, [JSON.stringify(combate), ahora, partidaId]);
      scheduleAutoSave(partidaId);

      io.to(partidaId).emit('combate_actualizado', combate);
    } catch (err) {
      console.error('[Combate] Error en anterior_turno:', err);
    }
  });

  // Terminar Combate (DM)
  socket.on('terminar_combate', async ({ partidaId }) => {
    try {
      if (!socket.data?.esDM) {
        return socket.emit('error_partida', 'Solo el DM puede terminar el combate.');
      }

      const combate = {
        activo: false,
        ronda: 1,
        turnoIndex: 0,
        participantes: []
      };

      const ahora = new Date().toISOString();
      await dbRun(`UPDATE partidas SET datos_combate = ?, fecha_modificacion = ? WHERE id = ?`, [JSON.stringify(combate), ahora, partidaId]);
      scheduleAutoSave(partidaId);

      io.to(partidaId).emit('combate_actualizado', combate);

      const mensajeTexto = `🏁 **El combate ha finalizado.**`;
      const msgId = uuidv4();
      await dbRun(
        `INSERT INTO mensajes (id, partida_id, usuario_id, nombre_usuario, color_usuario, mensaje, es_gif, fecha, nombre_ficha)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [msgId, partidaId, 'sistema', 'Sistema', '#c9a84c', mensajeTexto, 0, ahora, null]
      );
      io.to(partidaId).emit('nuevo_mensaje', {
        id: msgId,
        partida_id: partidaId,
        usuario_id: 'sistema',
        nombre_usuario: 'Sistema',
        color_usuario: '#c9a84c',
        mensaje: mensajeTexto,
        es_gif: 0,
        fecha: ahora,
        nombre_ficha: null
      });
    } catch (err) {
      console.error('[Combate] Error en terminar_combate:', err);
    }
  });

  // Actualizar participantes o iniciativas en combate en vivo (DM)
  socket.on('actualizar_combate', async ({ partidaId, combate }) => {
    try {
      if (!socket.data?.esDM) return;
      const ahora = new Date().toISOString();
      await dbRun(`UPDATE partidas SET datos_combate = ?, fecha_modificacion = ? WHERE id = ?`, [JSON.stringify(combate), ahora, partidaId]);
      scheduleAutoSave(partidaId);
      io.to(partidaId).emit('combate_actualizado', combate);
    } catch (err) {
      console.error('[Combate] Error en actualizar_combate:', err);
    }
  });

  // Agregar participantes al combate activo sin reiniciar la ronda (DM)
  socket.on('agregar_participantes_combate', async ({ partidaId, nuevosParticipantes }) => {
    try {
      if (!socket.data?.esDM) {
        return socket.emit('error_partida', 'Solo el DM puede agregar participantes al combate.');
      }

      const partida = await dbGet(`SELECT datos_combate FROM partidas WHERE id = ?`, [partidaId]);
      if (!partida || !partida.datos_combate) return;

      let combate = JSON.parse(partida.datos_combate);
      if (!combate || !combate.activo) {
        return socket.emit('error_partida', 'No hay un combate activo en este momento.');
      }

      const participantesActuales = combate.participantes || [];
      const turnoActualId = participantesActuales[combate.turnoIndex]?.id;

      // Filtrar sólo los que no estén ya en la ronda
      const idsExistentes = new Set(participantesActuales.map(p => p.id));
      const aAgregar = (nuevosParticipantes || []).filter(p => !idsExistentes.has(p.id));

      if (aAgregar.length === 0) return;

      // Combinar y ordenar por iniciativa (mayor a menor)
      const combinados = [...participantesActuales, ...aAgregar];
      combinados.sort((a, b) => {
        const iniA = Number(a.iniciativa) || 0;
        const iniB = Number(b.iniciativa) || 0;
        if (iniB !== iniA) return iniB - iniA;
        const desA = Number(a.destreza) || 10;
        const desB = Number(b.destreza) || 10;
        return desB - desA;
      });

      // Mantener el turno sobre el participante que estaba activo
      let nuevoTurnoIndex = 0;
      if (turnoActualId) {
        const idx = combinados.findIndex(p => p.id === turnoActualId);
        if (idx !== -1) nuevoTurnoIndex = idx;
      }

      combate.participantes = combinados;
      combate.turnoIndex = nuevoTurnoIndex;

      const ahora = new Date().toISOString();
      await dbRun(`UPDATE partidas SET datos_combate = ?, fecha_modificacion = ? WHERE id = ?`, [JSON.stringify(combate), ahora, partidaId]);
      scheduleAutoSave(partidaId);

      io.to(partidaId).emit('combate_actualizado', combate);

      // Notificar en el chat del sistema
      const nombresAgregados = aAgregar.map(p => `**${p.nombre}**`).join(', ');
      const mensajeTexto = `⚔️ Se han unido a la ronda ${combate.ronda}: ${nombresAgregados}`;
      const msgId = uuidv4();
      await dbRun(
        `INSERT INTO mensajes (id, partida_id, usuario_id, nombre_usuario, color_usuario, mensaje, es_gif, fecha, nombre_ficha)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [msgId, partidaId, 'sistema', 'Sistema', '#c9a84c', mensajeTexto, 0, ahora, null]
      );
      io.to(partidaId).emit('nuevo_mensaje', {
        id: msgId,
        partida_id: partidaId,
        usuario_id: 'sistema',
        nombre_usuario: 'Sistema',
        color_usuario: '#c9a84c',
        mensaje: mensajeTexto,
        es_gif: 0,
        fecha: ahora,
        nombre_ficha: null
      });
    } catch (err) {
      console.error('[Combate] Error en agregar_participantes_combate:', err);
    }
  });

  // Quitar participante del combate activo (DM)
  socket.on('quitar_participante_combate', async ({ partidaId, fichaId }) => {
    try {
      if (!socket.data?.esDM) {
        return socket.emit('error_partida', 'Solo el DM puede remover participantes del combate.');
      }

      const partida = await dbGet(`SELECT datos_combate FROM partidas WHERE id = ?`, [partidaId]);
      if (!partida || !partida.datos_combate) return;

      let combate = JSON.parse(partida.datos_combate);
      if (!combate || !combate.activo || !combate.participantes) return;

      const turnoActualId = combate.participantes[combate.turnoIndex]?.id;
      const participanteEliminado = combate.participantes.find(p => p.id === fichaId);
      combate.participantes = combate.participantes.filter(p => p.id !== fichaId);

      if (combate.participantes.length === 0) {
        combate.activo = false;
        combate.ronda = 1;
        combate.turnoIndex = 0;
      } else {
        let nuevoTurnoIndex = 0;
        if (turnoActualId && turnoActualId !== fichaId) {
          const idx = combate.participantes.findIndex(p => p.id === turnoActualId);
          if (idx !== -1) nuevoTurnoIndex = idx;
        } else {
          nuevoTurnoIndex = Math.min(combate.turnoIndex, combate.participantes.length - 1);
        }
        combate.turnoIndex = nuevoTurnoIndex;
      }

      const ahora = new Date().toISOString();
      await dbRun(`UPDATE partidas SET datos_combate = ?, fecha_modificacion = ? WHERE id = ?`, [JSON.stringify(combate), ahora, partidaId]);
      scheduleAutoSave(partidaId);

      io.to(partidaId).emit('combate_actualizado', combate);

      if (participanteEliminado) {
        const msgId = uuidv4();
        const mensajeTexto = `⚔️ **${participanteEliminado.nombre}** ha salido del combate.`;
        await dbRun(
          `INSERT INTO mensajes (id, partida_id, usuario_id, nombre_usuario, color_usuario, mensaje, es_gif, fecha, nombre_ficha)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [msgId, partidaId, 'sistema', 'Sistema', '#c9a84c', mensajeTexto, 0, ahora, null]
        );
        io.to(partidaId).emit('nuevo_mensaje', {
          id: msgId,
          partida_id: partidaId,
          usuario_id: 'sistema',
          nombre_usuario: 'Sistema',
          color_usuario: '#c9a84c',
          mensaje: mensajeTexto,
          es_gif: 0,
          fecha: ahora,
          nombre_ficha: null
        });
      }
    } catch (err) {
      console.error('[Combate] Error en quitar_participante_combate:', err);
    }
  });

  socket.on('disconnect', async () => {
    console.log(`❌ Cliente desconectado: ${socket.id}`);

    // Remover usuario de la lista de conectados y notificar
    const { partidaId, usuarioId } = socket.data || {};
    if (partidaId) {
      // Programar auto-guardado debounced (5s) en lugar de guardar sincrónico masivo
      try {
        scheduleAutoSave(partidaId, 5000);
      } catch (err) {
        console.error('[Servidor] Error al programar auto-guardado en desconexión:', err);
      }
    }
    if (partidaId && usuarioId && connectedUsers.has(partidaId)) {
      connectedUsers.get(partidaId).delete(usuarioId);
      const jugadoresConectados = Array.from(connectedUsers.get(partidaId).values());
      io.to(partidaId).emit('lista_jugadores', jugadoresConectados);

      // Limpiar el Map si no quedan usuarios
      if (connectedUsers.get(partidaId).size === 0) {
        connectedUsers.delete(partidaId);
      }
    }
  });
});

// Inicializar DB, Auto-Restaurar Partidas y Arrancar Servidor
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

async function bootstrap() {
  if (process.env.DATABASE_URL) {
    console.log('🔗 Conectando a PostgreSQL mediante process.env.DATABASE_URL...');
  }

  // 1. Inicialización de motor de base de datos
  await initDb();

  // 2. Consulta explícita CREATE TABLE IF NOT EXISTS para partidas y fichas
  await dbRun(`
    CREATE TABLE IF NOT EXISTS partidas (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      codigo TEXT UNIQUE NOT NULL,
      dm_id TEXT,
      escena_activa_id TEXT,
      fecha_creacion TEXT,
      fecha_modificacion TEXT,
      config_grid_x INTEGER DEFAULT 40,
      config_grid_y INTEGER DEFAULT 40,
      config_casilla INTEGER DEFAULT 5,
      imagen_portada TEXT,
      datos_combate TEXT,
      efectos_catalogo TEXT DEFAULT '[]'
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS fichas (
      id TEXT PRIMARY KEY,
      partida_id TEXT NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
      escena_id TEXT,
      nombre TEXT NOT NULL,
      tipo TEXT DEFAULT 'jugador',
      jugador_id TEXT,
      imagen TEXT,
      fuerza INTEGER DEFAULT 10,
      destreza INTEGER DEFAULT 10,
      constitucion INTEGER DEFAULT 10,
      inteligencia INTEGER DEFAULT 10,
      sabiduria INTEGER DEFAULT 10,
      carisma INTEGER DEFAULT 10,
      hp_actual INTEGER DEFAULT 10,
      hp_maximo INTEGER DEFAULT 10,
      ac INTEGER DEFAULT 10,
      velocidad INTEGER DEFAULT 30,
      iniciativa INTEGER DEFAULT 0,
      nivel INTEGER DEFAULT 1,
      altura INTEGER DEFAULT 2,
      tamanio_base TEXT DEFAULT 'mediano',
      color_aro TEXT DEFAULT '#c9a84c',
      gigante INTEGER DEFAULT 0,
      revelado TEXT DEFAULT '0',
      oculto INTEGER DEFAULT 0,
      notas TEXT,
      x REAL DEFAULT 0,
      y REAL DEFAULT 0,
      efectos TEXT DEFAULT '[]'
    )
  `);

  console.log('✅ Tablas "partidas" y "fichas" aseguradas con CREATE TABLE IF NOT EXISTS.');

  ensureDirectories();
  // Auto-restaurar partidas desde /data/saves/ si faltan en la base de datos (por caída o reinicio de contenedor)
  await autoRestoreFromFiles();
  // Migrar mapas antiguos en Base64 a archivos desacoplados en disco
  await migrarMapasExistentes();

  server.listen(PORT, HOST, () => {
    console.log(`
═════════════════════════════════════════════════════════════════
⚔️  VTT D&D 5e SERVER LISTENING ON http://${HOST}:${PORT}
🗄️  Motor de BD: ${isPostgres ? '🐘 PostgreSQL (Conexión activa)' : '📁 SQLite (Local vtt.db)'}
📁 Directorio de datos: ${dataDir}
🔮 Auto-Guardado en disco activo! 🎲
🛡️  Protección contra caídas y reinicios habilitada!
═════════════════════════════════════════════════════════════════
    `);
  });
}

bootstrap().catch(err => {
  console.error('Error fatal al iniciar la base de datos o el servidor:', err);
});

// Manejo de apagado seguro para evitar corrupción o pérdida de datos
let isShuttingDown = false;
async function shutdownGracefully(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n🛑 [Servidor] Recibida señal ${signal}. Guardando partidas activas y cerrando limpiamente...`);
  try {
    await saveAllPartidasImmediate();
    await checkpointDb();
    console.log('✅ [Servidor] Todas las partidas guardadas en disco y SQLite sincronizado.');
  } catch (err) {
    console.error('Error al guardar durante apagado:', err);
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdownGracefully('SIGINT'));
process.on('SIGTERM', () => shutdownGracefully('SIGTERM'));

process.on('uncaughtException', async (err) => {
  console.error('🔥 [Servidor] Excepción no capturada:', err);
  const code = err?.code || '';
  if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ETIMEDOUT' || code === 'ECONNABORTED') {
    console.warn('⚠️ [Servidor] Error de red no fatal ignorado para evitar caída del host.');
    return;
  }
  await shutdownGracefully('UNCAUGHT_EXCEPTION');
});
process.on('unhandledRejection', (reason) => {
  console.error('🔥 [Servidor] Promesa rechazada no manejada:', reason);
});
