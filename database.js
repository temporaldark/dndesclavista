const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Asegurar que exista la carpeta /data
const dataDir = path.join(__dirname, 'data');
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

// Inicialización de Tablas
async function initDb() {
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
      config_casilla INTEGER DEFAULT 5
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS escenas (
      id TEXT PRIMARY KEY,
      partida_id TEXT NOT NULL,
      nombre TEXT NOT NULL,
      mapa TEXT,
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

  console.log('✅ Base de datos SQLite inicializada correctamente en data/vtt.db');
}

module.exports = {
  db,
  dbRun,
  dbAll,
  dbGet,
  initDb
};
