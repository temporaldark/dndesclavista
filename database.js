require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');

// Detección de PostgreSQL vs SQLite
const isPostgres = Boolean(
  process.env.DATABASE_URL ||
  process.env.PGHOST ||
  process.env.USE_POSTGRES === 'true'
);

// Detección automática de volúmenes o directorio de datos para SQLite / archivos de backup
function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) return process.env.RAILWAY_VOLUME_MOUNT_PATH;

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

// Almacén asíncrono para gestionar clientes dentro de transacciones de PostgreSQL
const txStorage = new AsyncLocalStorage();

let pgPool = null;
let sqliteDb = null;

if (isPostgres) {
  const { Pool } = require('pg');
  let connectionString = process.env.DATABASE_URL;

  // Render a veces entrega postgres:// que node-postgres prefiere como postgresql://
  if (connectionString && connectionString.startsWith('postgres://')) {
    connectionString = connectionString.replace('postgres://', 'postgresql://');
  }

  const isSslDisabled = connectionString
    ? (connectionString.includes('localhost') ||
       connectionString.includes('127.0.0.1') ||
       connectionString.includes('.railway.internal') ||
       connectionString.includes('sslmode=disable'))
    : (process.env.PGHOST === 'localhost' ||
       process.env.PGHOST === '127.0.0.1' ||
       (process.env.PGHOST && process.env.PGHOST.includes('.railway.internal')) ||
       process.env.PGSSLMODE === 'disable');

  const poolConfig = connectionString
    ? {
        connectionString,
        ssl: isSslDisabled ? false : { rejectUnauthorized: false },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
      }
    : {
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432', 10),
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || '',
        database: process.env.PGDATABASE || 'vtt_dnd',
        ssl: isLocalhost ? false : (process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false),
        max: 20
      };

  pgPool = new Pool(poolConfig);
  pgPool.on('error', (err) => {
    console.error('Error imprevisto en el cliente del pool PostgreSQL:', err);
  });
} else {
  const sqlite3 = require('sqlite3').verbose();
  const dbPath = path.join(dataDir, 'vtt.db');
  sqliteDb = new sqlite3.Database(dbPath);
}

// Transformar sintaxis SQL de SQLite a PostgreSQL cuando aplique
function prepareSql(sql) {
  if (!isPostgres) return sql;

  let query = sql;

  // 1. Convertir INSERT OR REPLACE para posiciones_fichas
  if (/INSERT\s+OR\s+REPLACE\s+INTO\s+posiciones_fichas/i.test(query)) {
    query = query.replace(
      /INSERT\s+OR\s+REPLACE\s+INTO\s+posiciones_fichas\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i,
      'INSERT INTO posiciones_fichas ($1) VALUES ($2) ON CONFLICT (ficha_id, escena_id) DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y'
    );
  }
  // 2. Convertir INSERT OR REPLACE general (con clave primaria 'id')
  else if (/INSERT\s+OR\s+REPLACE\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i.test(query)) {
    query = query.replace(
      /INSERT\s+OR\s+REPLACE\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i,
      (match, table, cols, vals) => {
        const colList = cols.split(',').map(c => c.trim()).filter(Boolean);
        const updates = colList
          .filter(c => c !== 'id')
          .map(c => `${c} = EXCLUDED.${c}`)
          .join(', ');
        return `INSERT INTO ${table} (${cols}) VALUES (${vals}) ON CONFLICT (id) DO UPDATE SET ${updates}`;
      }
    );
  }
  // 3. Convertir INSERT OR IGNORE
  else if (/INSERT\s+OR\s+IGNORE\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i.test(query)) {
    query = query.replace(
      /INSERT\s+OR\s+IGNORE\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i,
      'INSERT INTO $1 ($2) VALUES ($3) ON CONFLICT DO NOTHING'
    );
  }

  // 4. Convertir funciones exclusivas de SQLite (datetime y rowid)
  query = query.replace(/datetime\s*\(\s*([^)]+)\s*\)/gi, '$1');
  query = query.replace(/\browid\b/gi, 'id');

  // 5. Convertir marcadores de parámetros '?' a '$1', '$2', ...
  let paramIdx = 1;
  query = query.replace(/\?/g, () => `$${paramIdx++}`);

  return query;
}

// Helper para ejecutar consultas async (INSERT, UPDATE, DELETE)
function dbRun(sql, params = []) {
  if (isPostgres) {
    const client = txStorage.getStore() || pgPool;
    const finalSql = prepareSql(sql);
    return client.query(finalSql, params).then(res => ({
      rowCount: res.rowCount
    }));
  }

  return new Promise((resolve, reject) => {
    sqliteDb.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// Helper para obtener todas las filas coincidentes
function dbAll(sql, params = []) {
  if (isPostgres) {
    const client = txStorage.getStore() || pgPool;
    const finalSql = prepareSql(sql);
    return client.query(finalSql, params).then(res => res.rows);
  }

  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// Helper para obtener una sola fila
function dbGet(sql, params = []) {
  if (isPostgres) {
    const client = txStorage.getStore() || pgPool;
    const finalSql = prepareSql(sql);
    return client.query(finalSql, params).then(res => res.rows[0] || null);
  }

  return new Promise((resolve, reject) => {
    sqliteDb.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

// Helper para transacciones atómicas
async function dbTransaction(fn) {
  if (isPostgres) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const result = await txStorage.run(client, fn);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

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

// Inicialización de Tablas e Índices
async function initDb() {
  if (isPostgres) {
    console.log('🐘 Inicializando esquemas en PostgreSQL...');

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
        partida_id TEXT NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
        nombre TEXT NOT NULL,
        mapa TEXT,
        config_grid_x INTEGER DEFAULT 40,
        config_grid_y INTEGER DEFAULT 40,
        config_casilla INTEGER DEFAULT 5
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS fichas (
        id TEXT PRIMARY KEY,
        partida_id TEXT NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
        escena_id TEXT REFERENCES escenas(id) ON DELETE CASCADE,
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
        y REAL DEFAULT 0
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS figuras (
        id TEXT PRIMARY KEY,
        escena_id TEXT NOT NULL REFERENCES escenas(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL,
        x REAL DEFAULT 0,
        y REAL DEFAULT 0,
        tamanio REAL DEFAULT 1,
        ancho REAL DEFAULT 1,
        alto REAL DEFAULT 1,
        color TEXT DEFAULT '#c9a84c',
        transparencia REAL DEFAULT 0.4,
        rotacion REAL DEFAULT 0,
        etiqueta TEXT,
        creador_id TEXT DEFAULT NULL
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS posiciones_fichas (
        ficha_id TEXT NOT NULL REFERENCES fichas(id) ON DELETE CASCADE,
        escena_id TEXT NOT NULL REFERENCES escenas(id) ON DELETE CASCADE,
        x REAL DEFAULT 0,
        y REAL DEFAULT 0,
        PRIMARY KEY (ficha_id, escena_id)
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS dibujos (
        id TEXT PRIMARY KEY,
        escena_id TEXT UNIQUE NOT NULL REFERENCES escenas(id) ON DELETE CASCADE,
        datos TEXT
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS mensajes (
        id TEXT PRIMARY KEY,
        partida_id TEXT NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
        usuario_id TEXT,
        nombre_usuario TEXT,
        color_usuario TEXT,
        mensaje TEXT,
        es_gif INTEGER DEFAULT 0,
        fecha TEXT,
        nombre_ficha TEXT
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS historial_dados (
        id TEXT PRIMARY KEY,
        partida_id TEXT NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
        usuario_id TEXT,
        nombre_usuario TEXT,
        formula TEXT,
        tipo TEXT,
        resultado INTEGER,
        fecha TEXT,
        nombre_ficha TEXT
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS galeria (
        id TEXT PRIMARY KEY,
        partida_id TEXT NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
        nombre TEXT NOT NULL,
        datos TEXT NOT NULL
      )
    `);

    // Migraciones automáticas seguras en PostgreSQL
    try { await dbRun(`ALTER TABLE figuras ADD COLUMN IF NOT EXISTS ancho REAL DEFAULT 1`); } catch (_) {}
    try { await dbRun(`ALTER TABLE figuras ADD COLUMN IF NOT EXISTS alto REAL DEFAULT 1`); } catch (_) {}
    try { await dbRun(`ALTER TABLE figuras ADD COLUMN IF NOT EXISTS rotacion REAL DEFAULT 0`); } catch (_) {}
    try { await dbRun(`ALTER TABLE partidas ADD COLUMN IF NOT EXISTS imagen_portada TEXT`); } catch (_) {}
    try { await dbRun(`ALTER TABLE partidas ADD COLUMN IF NOT EXISTS datos_combate TEXT`); } catch (_) {}
    try { await dbRun(`ALTER TABLE fichas ADD COLUMN IF NOT EXISTS color_aro TEXT DEFAULT '#c9a84c'`); } catch (_) {}
    try { await dbRun(`ALTER TABLE fichas ADD COLUMN IF NOT EXISTS oculto INTEGER DEFAULT 0`); } catch (_) {}
    try { await dbRun(`ALTER TABLE escenas ADD COLUMN IF NOT EXISTS config_grid_x INTEGER DEFAULT 40`); } catch (_) {}
    try { await dbRun(`ALTER TABLE escenas ADD COLUMN IF NOT EXISTS config_grid_y INTEGER DEFAULT 40`); } catch (_) {}
    try { await dbRun(`ALTER TABLE escenas ADD COLUMN IF NOT EXISTS config_casilla INTEGER DEFAULT 5`); } catch (_) {}
    try { await dbRun(`ALTER TABLE historial_dados ADD COLUMN IF NOT EXISTS nombre_ficha TEXT`); } catch (_) {}
    try { await dbRun(`ALTER TABLE mensajes ADD COLUMN IF NOT EXISTS nombre_ficha TEXT`); } catch (_) {}

    // Índices de rendimiento
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_fichas_partida ON fichas(partida_id)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_fichas_escena ON fichas(escena_id)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_escenas_partida ON escenas(partida_id)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_posiciones_ficha_escena ON posiciones_fichas(ficha_id, escena_id)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_figuras_escena ON figuras(escena_id)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_mensajes_partida ON mensajes(partida_id)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_historial_partida ON historial_dados(partida_id)`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_galeria_partida ON galeria(partida_id)`);

    console.log('✅ Base de datos PostgreSQL inicializada con esquemas e índices.');
    return;
  }

  // Si no hay PostgreSQL configurado, inicializar SQLite
  await dbRun(`PRAGMA journal_mode = WAL;`);
  await dbRun(`PRAGMA synchronous = NORMAL;`);
  await dbRun(`PRAGMA cache_size = 10000;`);
  await dbRun(`PRAGMA temp_store = MEMORY;`);
  await dbRun(`PRAGMA foreign_keys = ON;`);
  await dbRun(`PRAGMA busy_timeout = 5000;`);
  await dbRun(`PRAGMA mmap_size = 268435456;`);

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
      gigante BOOLEAN DEFAULT 0,
      revelado TEXT DEFAULT '0',
      oculto BOOLEAN DEFAULT 0,
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
      tipo TEXT NOT NULL,
      x REAL DEFAULT 0,
      y REAL DEFAULT 0,
      tamanio REAL DEFAULT 1,
      ancho REAL DEFAULT 1,
      alto REAL DEFAULT 1,
      color TEXT DEFAULT '#c9a84c',
      transparencia REAL DEFAULT 0.4,
      rotacion REAL DEFAULT 0,
      etiqueta TEXT,
      creador_id TEXT DEFAULT NULL,
      FOREIGN KEY (escena_id) REFERENCES escenas(id) ON DELETE CASCADE
    )
  `);

  try { await dbRun(`ALTER TABLE figuras ADD COLUMN ancho REAL DEFAULT 1`); } catch (_) {}
  try { await dbRun(`ALTER TABLE figuras ADD COLUMN alto REAL DEFAULT 1`); } catch (_) {}
  try { await dbRun(`ALTER TABLE figuras ADD COLUMN rotacion REAL DEFAULT 0`); } catch (_) {}

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
      datos TEXT,
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
      nombre_ficha TEXT,
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
      nombre_ficha TEXT,
      FOREIGN KEY (partida_id) REFERENCES partidas(id) ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS galeria (
      id TEXT PRIMARY KEY,
      partida_id TEXT NOT NULL,
      nombre TEXT NOT NULL,
      datos TEXT NOT NULL,
      FOREIGN KEY (partida_id) REFERENCES partidas(id) ON DELETE CASCADE
    )
  `);

  try { await dbRun(`ALTER TABLE partidas ADD COLUMN imagen_portada TEXT`); } catch (_) {}
  try { await dbRun(`ALTER TABLE partidas ADD COLUMN datos_combate TEXT`); } catch (_) {}
  try { await dbRun(`ALTER TABLE fichas ADD COLUMN color_aro TEXT DEFAULT '#c9a84c'`); } catch (_) {}
  try { await dbRun(`ALTER TABLE fichas ADD COLUMN oculto BOOLEAN DEFAULT 0`); } catch (_) {}
  try { await dbRun(`ALTER TABLE escenas ADD COLUMN config_grid_x INTEGER DEFAULT 40`); } catch (_) {}
  try { await dbRun(`ALTER TABLE escenas ADD COLUMN config_grid_y INTEGER DEFAULT 40`); } catch (_) {}
  try { await dbRun(`ALTER TABLE escenas ADD COLUMN config_casilla INTEGER DEFAULT 5`); } catch (_) {}
  try { await dbRun(`ALTER TABLE historial_dados ADD COLUMN nombre_ficha TEXT`); } catch (_) {}
  try { await dbRun(`ALTER TABLE mensajes ADD COLUMN nombre_ficha TEXT`); } catch (_) {}

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

// Checkpoint manual para vaciar WAL (solo en SQLite)
async function checkpointDb() {
  if (isPostgres) return;
  try {
    await dbRun(`PRAGMA wal_checkpoint(TRUNCATE)`);
  } catch (err) {
    console.error('Error al hacer checkpoint de WAL en SQLite:', err);
  }
}

module.exports = {
  db: isPostgres ? pgPool : sqliteDb,
  dbRun,
  dbAll,
  dbGet,
  dbTransaction,
  initDb,
  checkpointDb,
  getDataDir,
  dataDir,
  isPostgres
};
