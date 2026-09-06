const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Detección automática de volúmenes persistentes (Railway / Docker / Local)
function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) return process.env.RAILWAY_VOLUME_MOUNT_PATH;

  // En Linux/Railway, si existe /data en la raíz con permisos de escritura (volumen común de Railway)
  if (process.platform !== 'win32' && fs.existsSync('/data')) {
    try {
      fs.accessSync('/data', fs.constants.W_OK);
      return '/data';
    } catch (_) {}
  }

  return path.join(__dirname, 'data');
}

const dataDir = getDataDir();
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'vtt.db');
const db = new sqlite3.Database(dbPath);

// Helper para ejecutar consultas async
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// Helper para transacciones atómicas por lotes
async function dbTransaction(fn) {
  await dbRun('BEGIN TRANSACTION');
  try {
    const result = await fn();
    await dbRun('COMMIT');
    return result;
  } catch (err) {
    await dbRun('ROLLBACK');
    throw err;
  }
}

// Inicialización de Tablas y Optimizaciones SQLite
async function initDb() {
  // Optimizaciones de alto rendimiento para SQLite
  await dbRun(`PRAGMA journal_mode = WAL;`);
  await dbRun(`PRAGMA synchronous = NORMAL;`);
  await dbRun(`PRAGMA cache_size = 10000;`);
  await dbRun(`PRAGMA temp_store = MEMORY;`);
  await dbRun(`PRAGMA foreign_keys = ON;`);
  await dbRun(`PRAGMA busy_timeout = 5000;`);
  await dbRun(`PRAGMA mmap_size = 268435456;`); // 256MB memory-mapped I/O

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
      datos_combate TEXT
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS escenas (
      id TEXT PRIMARY KEY,
      partida_id TEXT NOT NULL,
      nombre TEXT NOT NULL,
      mapa TEXT,
      config_grid_x INTEGER DEFAULT 40,
      config_grid_y INTEGER DEFAULT 40,
      config_casilla INTEGER DEFAULT 5,
      FOREIGN KEY (partida_id) REFERENCES partidas(id) ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS fichas (
      id TEXT PRIMARY KEY,
      partida_id TEXT NOT NULL,
      escena_id TEXT,
      nombre TEXT NOT NULL,
      tipo TEXT DEFAULT 'jugador', -- 'jugador', 'npc', 'monstruo'
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
      tamanio_base TEXT DEFAULT 'mediano', -- 'pequeno', 'mediano', 'grande', 'enorme'
      gigante BOOLEAN DEFAULT 0,
      revelado BOOLEAN DEFAULT 0,
      notas TEXT,
      x REAL DEFAULT 0,
      y REAL DEFAULT 0,
      FOREIGN KEY (partida_id) REFERENCES partidas(id) ON DELETE CASCADE,
      FOREIGN KEY (escena_id) REFERENCES escenas(id) ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS figuras (
      id TEXT PRIMARY KEY,
      escena_id TEXT NOT NULL,
      tipo TEXT NOT NULL, -- 'circulo', 'cuadrado', 'cono'
      x REAL DEFAULT 0,
      y REAL DEFAULT 0,
      tamanio REAL DEFAULT 1,
      color TEXT DEFAULT '#c9a84c',
      transparencia REAL DEFAULT 0.4,
      rotacion REAL DEFAULT 0,
      etiqueta TEXT,
      creador_id TEXT DEFAULT NULL,
      FOREIGN KEY (escena_id) REFERENCES escenas(id) ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS posiciones_fichas (
      ficha_id TEXT NOT NULL,
      escena_id TEXT NOT NULL,
      x REAL DEFAULT 0,
      y REAL DEFAULT 0,
      PRIMARY KEY (ficha_id, escena_id),
      FOREIGN KEY (ficha_id) REFERENCES fichas(id) ON DELETE CASCADE,
      FOREIGN KEY (escena_id) REFERENCES escenas(id) ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS dibujos (
      id TEXT PRIMARY KEY,
      escena_id TEXT UNIQUE NOT NULL,
      datos TEXT, -- Array JSON de trazos
      FOREIGN KEY (escena_id) REFERENCES escenas(id) ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS mensajes (
      id TEXT PRIMARY KEY,
      partida_id TEXT NOT NULL,
      usuario_id TEXT,
      nombre_usuario TEXT,
      color_usuario TEXT,
      mensaje TEXT,
      es_gif BOOLEAN DEFAULT 0,
      fecha TEXT,
      FOREIGN KEY (partida_id) REFERENCES partidas(id) ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS historial_dados (
      id TEXT PRIMARY KEY,
      partida_id TEXT NOT NULL,
      usuario_id TEXT,
      nombre_usuario TEXT,
      formula TEXT,
      tipo TEXT,
      resultado INTEGER,
      fecha TEXT,
      FOREIGN KEY (partida_id) REFERENCES partidas(id) ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS galeria (
      id TEXT PRIMARY KEY,
      partida_id TEXT NOT NULL,
      nombre TEXT NOT NULL,
      datos TEXT NOT NULL, -- JSON de la ficha plantilla
      FOREIGN KEY (partida_id) REFERENCES partidas(id) ON DELETE CASCADE
    )
  `);

  // Add rotacion to figuras if it doesn't exist
  try {
    await dbRun(`ALTER TABLE figuras ADD COLUMN rotacion REAL DEFAULT 0`);
  } catch (err) {
    // Ignore error if column already exists
  }

  // Add imagen_portada to partidas if it doesn't exist
  try {
    await dbRun(`ALTER TABLE partidas ADD COLUMN imagen_portada TEXT`);
  } catch (err) {
    // Ignore error if column already exists
  }

  // Add datos_combate to partidas if it doesn't exist
  try {
    await dbRun(`ALTER TABLE partidas ADD COLUMN datos_combate TEXT`);
  } catch (err) {
    // Ignore error if column already exists
  }

  // Add color_aro to fichas if it doesn't exist
  try {
    await dbRun(`ALTER TABLE fichas ADD COLUMN color_aro TEXT DEFAULT '#c9a84c'`);
  } catch (err) {
    // Ignore error if column already exists
  }

  // Add oculto to fichas if it doesn't exist
  try {
    await dbRun(`ALTER TABLE fichas ADD COLUMN oculto BOOLEAN DEFAULT 0`);
  } catch (err) {
    // Ignore error if column already exists
  }

  // Add grid config to escenas if they don't exist
  try {
    await dbRun(`ALTER TABLE escenas ADD COLUMN config_grid_x INTEGER DEFAULT 40`);
    await dbRun(`ALTER TABLE escenas ADD COLUMN config_grid_y INTEGER DEFAULT 40`);
    await dbRun(`ALTER TABLE escenas ADD COLUMN config_casilla INTEGER DEFAULT 5`);
  } catch (err) {
    // Ignore error if column already exists
  }

  // Add nombre_ficha to historial_dados and mensajes if they don't exist
  try {
    await dbRun(`ALTER TABLE historial_dados ADD COLUMN nombre_ficha TEXT`);
  } catch (err) {
    // Ignore error if column already exists
  }
  try {
    await dbRun(`ALTER TABLE mensajes ADD COLUMN nombre_ficha TEXT`);
  } catch (err) {
    // Ignore error if column already exists
  }

  // Índices de rendimiento para consultas concurrentes rápidas
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_fichas_partida ON fichas(partida_id)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_fichas_escena ON fichas(escena_id)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_escenas_partida ON escenas(partida_id)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_posiciones_ficha_escena ON posiciones_fichas(ficha_id, escena_id)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_figuras_escena ON figuras(escena_id)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_mensajes_partida ON mensajes(partida_id)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_historial_partida ON historial_dados(partida_id)`);
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_galeria_partida ON galeria(partida_id)`);

  console.log('✅ Base de datos SQLite inicializada correctamente con modo WAL e índices');
}

// Checkpoint manual para vaciar WAL y garantizar que el archivo .db esté al día
async function checkpointDb() {
  try {
    await dbRun(`PRAGMA wal_checkpoint(TRUNCATE)`);
  } catch (err) {
    console.error('Error al hacer checkpoint de WAL:', err);
  }
}

module.exports = {
  db,
  dbRun,
  dbAll,
  dbGet,
  dbTransaction,
  initDb,
  checkpointDb,
  getDataDir,
  dataDir
};
