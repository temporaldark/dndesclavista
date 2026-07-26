const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { dbRun, dbAll, dbGet, initDb } = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e8 // 100MB para imágenes de mapa base64 de alta resolución
});

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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

// Listar todas las partidas guardadas
app.get('/api/partidas', async (req, res) => {
  try {
    const partidas = await dbAll(`
      SELECT p.*, 
        (SELECT COUNT(DISTINCT f.jugador_id) FROM fichas f WHERE f.partida_id = p.id AND f.jugador_id IS NOT NULL) as total_jugadores
      FROM partidas p 
      ORDER BY datetime(p.fecha_modificacion) DESC
    `);
    res.json(partidas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear una nueva partida
app.post('/api/partidas', async (req, res) => {
  try {
    const { nombre, configGridX = 40, configGridY = 40, configCasilla = 5 } = req.body;
    const partidaId = uuidv4();
    const escenaId = uuidv4();
    const codigo = generarCodigoPartida();
    const ahora = new Date().toISOString();

    // Insertar partida
    await dbRun(
      `INSERT INTO partidas (id, nombre, codigo, escena_activa_id, fecha_creacion, fecha_modificacion, config_grid_x, config_grid_y, config_casilla)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [partidaId, nombre || 'Nueva Partida', codigo, escenaId, ahora, ahora, configGridX, configGridY, configCasilla]
    );

    // Crear escena por defecto
    await dbRun(
      `INSERT INTO escenas (id, partida_id, nombre, mapa) VALUES (?, ?, ?, ?)`,
      [escenaId, partidaId, 'Mazmorra Principal', null]
    );

    res.json({ id: partidaId, codigo, escenaId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar partida
app.delete('/api/partidas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await dbRun(`DELETE FROM partidas WHERE id = ?`, [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Buscar GIFs via scraper de Tenor
app.get('/api/gifs', async (req, res) => {
  const query = req.query.q || 'dnd';
  try {
    const url = `https://tenor.com/search/${encodeURIComponent(query)}-gifs`;
    const response = await fetch(url);
    const html = await response.text();
    
    // Scrape window.__PRELOADED_STATE__ from Tenor HTML
    const regex = /window\.__PRELOADED_STATE__\s*=\s*(\{.*?\});\s*<\/script>/;
    const match = html.match(regex);
    if (match && match[1]) {
      const state = JSON.parse(match[1]);
      const results = state.gifs?.byId || {};
      const gifs = Object.values(results).map(gif => {
        // Find best tiny or regular gif URL
        let bestUrl = '';
        if (gif.media_formats?.tinygif?.url) bestUrl = gif.media_formats.tinygif.url;
        else if (gif.media_formats?.gif?.url) bestUrl = gif.media_formats.gif.url;
        else if (gif.media_formats?.mediumgif?.url) bestUrl = gif.media_formats.mediumgif.url;
        else if (gif.media_formats?.gifpreview?.url) bestUrl = gif.media_formats.gifpreview.url;
        
        return {
          url: bestUrl,
          name: gif.title || query,
          tag: query
        };
      }).filter(g => g.url);
      
      res.json(gifs.slice(0, 20));
    } else {
      res.json([]);
    }
  } catch (err) {
    console.error('Error fetching gifs from Tenor API proxy:', err);
    res.json([]);
  }
});

// Exportar partida completa (Backup JSON para DM)
app.get('/api/partidas/:id/export', async (req, res) => {
  try {
    const { id } = req.params;
    const partida = await dbGet(`SELECT * FROM partidas WHERE id = ?`, [id]);
    if (!partida) return res.status(404).json({ error: 'Partida no encontrada' });

    const escenas = await dbAll(`SELECT * FROM escenas WHERE partida_id = ?`, [id]);
    const fichas = await dbAll(`SELECT * FROM fichas WHERE partida_id = ?`, [id]);
    const mensajes = await dbAll(`SELECT * FROM mensajes WHERE partida_id = ?`, [id]);
    const historial = await dbAll(`SELECT * FROM historial_dados WHERE partida_id = ?`, [id]);
    const galeria = await dbAll(`SELECT * FROM galeria WHERE partida_id = ?`, [id]);

    const backup = {
      partida,
      escenas,
      fichas,
      mensajes,
      historial,
      galeria,
      fechaExport: new Date().toISOString()
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=partida_${partida.codigo}.json`);
    res.send(JSON.stringify(backup, null, 2));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- SOCKET.IO HANDLERS ---

io.on('connection', (socket) => {
  console.log(`🔌 Cliente conectado: ${socket.id}`);

  // Unirse a una partida con código
  socket.on('unirse_partida', async ({ codigo, nombreUsuario, usuarioId, esDMRequested }) => {
    try {
      const partida = await dbGet(`SELECT * FROM partidas WHERE codigo = ?`, [codigo?.toUpperCase()]);
      if (!partida) {
        return socket.emit('error_partida', 'Código de partida inválido o no existe.');
      }

      // Determinar si es DM
      let esDM = false;
      if (!partida.dm_id) {
        // El primero que entra/crea la partida se asigna como DM
        await dbRun(`UPDATE partidas SET dm_id = ? WHERE id = ?`, [usuarioId, partida.id]);
        esDM = true;
      } else if (partida.dm_id === usuarioId || esDMRequested) {
        esDM = true;
      }

      // Asignar color aleatorio al usuario
      const colorUsuario = COLORES_USUARIOS[Math.floor(Math.random() * COLORES_USUARIOS.length)];

      socket.join(partida.id);
      socket.data = { partidaId: partida.id, usuarioId, nombreUsuario, esDM, colorUsuario };

      // Obtener escena activa
      let escenaActiva = await dbGet(`SELECT * FROM escenas WHERE id = ?`, [partida.escena_activa_id]);
      if (!escenaActiva) {
        escenaActiva = await dbGet(`SELECT * FROM escenas WHERE partida_id = ? ORDER BY rowid ASC LIMIT 1`, [partida.id]);
      }

      // Obtener listas completas
      const escenas = await dbAll(`SELECT id, nombre FROM escenas WHERE partida_id = ?`, [partida.id]);
      const fichas = await dbAll(`SELECT * FROM fichas WHERE partida_id = ?`, [partida.id]);
      const figuras = escenaActiva ? await dbAll(`SELECT * FROM figuras WHERE escena_id = ?`, [escenaActiva.id]) : [];
      const dibujoRow = escenaActiva ? await dbGet(`SELECT datos FROM dibujos WHERE escena_id = ?`, [escenaActiva.id]) : null;
      const dibujos = dibujoRow ? JSON.parse(dibujoRow.datos || '[]') : [];
      const mensajes = await dbAll(`SELECT * FROM mensajes WHERE partida_id = ? ORDER BY datetime(fecha) ASC LIMIT 100`, [partida.id]);
      const historial = await dbAll(`SELECT * FROM historial_dados WHERE partida_id = ? ORDER BY datetime(fecha) DESC LIMIT 100`, [partida.id]);
      const galeria = esDM ? await dbAll(`SELECT * FROM galeria WHERE partida_id = ?`, [partida.id]) : [];

      // Responder con estado inicial
      // Registrar usuario conectado
      if (!connectedUsers.has(partida.id)) {
        connectedUsers.set(partida.id, new Map());
      }
      connectedUsers.get(partida.id).set(usuarioId, {
        id: usuarioId,
        nombre: nombreUsuario,
        esDM,
        color: colorUsuario,
        socketId: socket.id
      });

      // Preparar lista de jugadores conectados
      const jugadoresConectados = Array.from(connectedUsers.get(partida.id).values());

      socket.emit('estado_inicial', {
        partida,
        escenaActiva,
        escenas,
        fichas,
        figuras,
        dibujos,
        mensajes,
        historial,
        galeria,
        jugadoresConectados,
        usuario: { id: usuarioId, nombre: nombreUsuario, esDM, color: colorUsuario }
      });

      // Emitir lista de jugadores actualizada a toda la sala
      io.to(partida.id).emit('lista_jugadores', jugadoresConectados);

      // Notificar a la sala
      io.to(partida.id).emit('usuario_conectado', {
        id: usuarioId,
        nombre: nombreUsuario,
        esDM,
        color: colorUsuario
      });

    } catch (err) {
      console.error('Error al unirse a la partida:', err);
      socket.emit('error_partida', 'Error en el servidor al cargar la partida.');
    }
  });

  // Cambiar escena (DM)
  socket.on('cambiar_escena', async ({ partidaId, escenaId }) => {
    try {
      await dbRun(`UPDATE partidas SET escena_activa_id = ?, fecha_modificacion = ? WHERE id = ?`, [escenaId, new Date().toISOString(), partidaId]);
      const escenaActiva = await dbGet(`SELECT * FROM escenas WHERE id = ?`, [escenaId]);
      const figuras = await dbAll(`SELECT * FROM figuras WHERE escena_id = ?`, [escenaId]);
      const dibujoRow = await dbGet(`SELECT datos FROM dibujos WHERE escena_id = ?`, [escenaId]);
      const dibujos = dibujoRow ? JSON.parse(dibujoRow.datos || '[]') : [];

      io.to(partidaId).emit('escena_cambiada', { escenaActiva, figuras, dibujos });
    } catch (err) {
      console.error(err);
    }
  });

  // Crear escena (DM)
  socket.on('crear_escena', async ({ partidaId, nombre }) => {
    try {
      const escenaId = uuidv4();
      await dbRun(`INSERT INTO escenas (id, partida_id, nombre, mapa) VALUES (?, ?, ?, ?)`, [escenaId, partidaId, nombre, null]);
      const escenas = await dbAll(`SELECT id, nombre FROM escenas WHERE partida_id = ?`, [partidaId]);
      io.to(partidaId).emit('escenas_actualizadas', escenas);
    } catch (err) {
      console.error(err);
    }
  });

  // Eliminar escena (DM)
  socket.on('eliminar_escena', async ({ partidaId, escenaId }) => {
    try {
      await dbRun(`DELETE FROM escenas WHERE id = ?`, [escenaId]);
      const escenas = await dbAll(`SELECT id, nombre FROM escenas WHERE partida_id = ?`, [partidaId]);
      io.to(partidaId).emit('escenas_actualizadas', escenas);
    } catch (err) {
      console.error(err);
    }
  });

  // Actualizar imagen de mapa de una escena (DM)
  socket.on('actualizar_mapa', async ({ partidaId, escenaId, mapaBase64 }) => {
    try {
      await dbRun(`UPDATE escenas SET mapa = ? WHERE id = ?`, [mapaBase64, escenaId]);
      await dbRun(`UPDATE partidas SET fecha_modificacion = ? WHERE id = ?`, [new Date().toISOString(), partidaId]);
      io.to(partidaId).emit('mapa_actualizado', { escenaId, mapa: mapaBase64 });
    } catch (err) {
      console.error(err);
    }
  });

  // Actualizar tamaño de Grid (DM)
  socket.on('actualizar_grid', async ({ partidaId, gridX, gridY, casilla }) => {
    try {
      await dbRun(
        `UPDATE partidas SET config_grid_x = ?, config_grid_y = ?, config_casilla = ?, fecha_modificacion = ? WHERE id = ?`,
        [gridX, gridY, casilla, new Date().toISOString(), partidaId]
      );
      io.to(partidaId).emit('grid_actualizado', { gridX, gridY, casilla });
    } catch (err) {
      console.error(err);
    }
  });

  // Mover ficha en el grid
  socket.on('mover_ficha', async ({ partidaId, escenaId, fichaId, x, y }) => {
    try {
      await dbRun(`UPDATE fichas SET x = ?, y = ? WHERE id = ?`, [x, y, fichaId]);
      io.to(partidaId).emit('ficha_movida', { fichaId, x, y });
    } catch (err) {
      console.error(err);
    }
  });

  // Crear ficha (Jugador / DM)
  socket.on('crear_ficha', async ({ partidaId, escenaId, fichaData }) => {
    try {
      const id = uuidv4();
      const {
        nombre, tipo, jugadorId, jugador_id, imagen, fuerza, destreza, constitucion,
        inteligencia, sabiduria, carisma, hpActual, hpMaximo, ac, velocidad,
        iniciativa, nivel, altura, tamanioBase, notas, x = 5, y = 5, revelado = 0
      } = fichaData;

      const ownerId = jugador_id || jugadorId || socket.data?.usuarioId;

      const defaultRevelado = JSON.stringify({
        global: { imagen: false, nombre: false, hp: false, ac: false, notas: false },
        jugadores: {}
      });

      await dbRun(
        `INSERT INTO fichas (id, partida_id, escena_id, nombre, tipo, jugador_id, imagen, fuerza, destreza, constitucion, inteligencia, sabiduria, carisma, hp_actual, hp_maximo, ac, velocidad, iniciativa, nivel, altura, tamanio_base, notas, x, y, revelado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, partidaId, escenaId, nombre, tipo || 'jugador', ownerId, imagen, fuerza || 10, destreza || 10, constitucion || 10, inteligencia || 10, sabiduria || 10, carisma || 10, hpActual || 10, hpMaximo || 10, ac || 10, velocidad || 30, iniciativa || 0, nivel || 1, altura || 2, tamanioBase || 'mediano', notas || '', x, y, revelado !== undefined ? revelado : defaultRevelado]
      );

      const nuevaFicha = await dbGet(`SELECT * FROM fichas WHERE id = ?`, [id]);
      io.to(partidaId).emit('ficha_creada', nuevaFicha);
    } catch (err) {
      console.error(err);
    }
  });

  // Actualizar ficha
  socket.on('actualizar_ficha', async ({ partidaId, fichaData }) => {
    try {
      const {
        id, nombre, tipo, imagen, fuerza, destreza, constitucion,
        inteligencia, sabiduria, carisma, hp_actual, hp_maximo, ac, velocidad,
        iniciativa, nivel, altura, tamanio_base, gigante, notas, revelado
      } = fichaData;

      await dbRun(
        `UPDATE fichas SET nombre = ?, tipo = ?, imagen = ?, fuerza = ?, destreza = ?, constitucion = ?, inteligencia = ?, sabiduria = ?, carisma = ?, hp_actual = ?, hp_maximo = ?, ac = ?, velocidad = ?, iniciativa = ?, nivel = ?, altura = ?, tamanio_base = ?, gigante = ?, notas = ?, revelado = ? WHERE id = ?`,
        [nombre, tipo, imagen, fuerza, destreza, constitucion, inteligencia, sabiduria, carisma, hp_actual, hp_maximo, ac, velocidad, iniciativa, nivel, altura, tamanio_base, gigante ? 1 : 0, notas, revelado, id]
      );

      const fichaActualizada = await dbGet(`SELECT * FROM fichas WHERE id = ?`, [id]);
      io.to(partidaId).emit('ficha_actualizada', fichaActualizada);
    } catch (err) {
      console.error(err);
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
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Eliminar ficha
  socket.on('eliminar_ficha', async ({ partidaId, fichaId }) => {
    try {
      await dbRun(`DELETE FROM fichas WHERE id = ?`, [fichaId]);
      io.to(partidaId).emit('ficha_eliminada', fichaId);
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
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Guardar figura geométrica
  socket.on('guardar_figura', async ({ partidaId, escenaId, figuraData }) => {
    try {
      const id = figuraData.id || uuidv4();
      const { tipo, x, y, tamanio, color, transparencia, etiqueta, creador_id } = figuraData;

      await dbRun(
        `INSERT INTO figuras (id, escena_id, tipo, x, y, tamanio, color, transparencia, etiqueta, creador_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET tipo=excluded.tipo, x=excluded.x, y=excluded.y, tamanio=excluded.tamanio, color=excluded.color, transparencia=excluded.transparencia, etiqueta=excluded.etiqueta, creador_id=excluded.creador_id`,
        [id, escenaId, tipo, x, y, tamanio, color, transparencia, etiqueta, creador_id]
      );

      const figuras = await dbAll(`SELECT * FROM figuras WHERE escena_id = ?`, [escenaId]);
      io.to(partidaId).emit('figuras_actualizadas', figuras);
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
    } catch (err) {
      console.error(err);
    }
  });

  // Limpiar dibujos
  socket.on('limpiar_dibujos', async ({ partidaId, escenaId }) => {
    try {
      await dbRun(`DELETE FROM dibujos WHERE escena_id = ?`, [escenaId]);
      io.to(partidaId).emit('dibujos_actualizados', []);
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
    } catch (err) {
      console.error(err);
    }
  });

  // Lanzar dados e insertar en historial
  socket.on('lanzar_dados', async ({ partidaId, usuarioId, nombreUsuario, formula, tipo, resultado, fichaId, icono }) => {
    try {
      const id = uuidv4();
      const fecha = new Date().toISOString();

      await dbRun(
        `INSERT INTO historial_dados (id, partida_id, usuario_id, nombre_usuario, formula, tipo, resultado, fecha)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, partidaId, usuarioId, nombreUsuario, formula, tipo, resultado, fecha]
      );

      const nuevoRegistro = { id, partida_id: partidaId, usuario_id: usuarioId, nombre_usuario: nombreUsuario, formula, tipo, resultado, fecha };
      io.to(partidaId).emit('nueva_tirada', nuevoRegistro);

      // Emitir mensaje en chat
      const msgId = uuidv4();
      const mensajeTexto = `🎲 ha lanzado ${formula} para [${tipo}] y ha sacado **${resultado}**`;
      await dbRun(
        `INSERT INTO mensajes (id, partida_id, usuario_id, nombre_usuario, color_usuario, mensaje, es_gif, fecha)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
        [msgId, partidaId, usuarioId, nombreUsuario, socket.data?.colorUsuario || '#c9a84c', mensajeTexto, fecha]
      );

      io.to(partidaId).emit('nuevo_mensaje', {
        id: msgId,
        partida_id: partidaId,
        usuario_id: usuarioId,
        nombre_usuario: nombreUsuario,
        color_usuario: socket.data?.colorUsuario || '#c9a84c',
        mensaje: mensajeTexto,
        es_gif: 0,
        fecha
      });

      // Si se especificó una ficha, emitir animación sobre la ficha en el mapa
      if (fichaId) {
        io.to(partidaId).emit('animacion_dado_ficha', { fichaId, icono: icono || '🎲', resultado });
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Limpiar historial de dados (DM)
  socket.on('limpiar_historial', async ({ partidaId }) => {
    try {
      await dbRun(`DELETE FROM historial_dados WHERE partida_id = ?`, [partidaId]);
      io.to(partidaId).emit('historial_limpiado');
    } catch (err) {
      console.error(err);
    }
  });

  // Guardar ficha en Galería de DM
  socket.on('guardar_galeria', async ({ partidaId, nombre, datos }) => {
    try {
      const id = uuidv4();
      const datosJson = JSON.stringify(datos);
      await dbRun(`INSERT INTO galeria (id, partida_id, nombre, datos) VALUES (?, ?, ?, ?)`, [id, partidaId, nombre, datosJson]);
      const galeria = await dbAll(`SELECT * FROM galeria WHERE partida_id = ?`, [partidaId]);
      socket.emit('galeria_actualizada', galeria);
    } catch (err) {
      console.error(err);
    }
  });

  // Eliminar elemento de la Galería DM
  socket.on('eliminar_galeria', async ({ partidaId, galeriaId }) => {
    try {
      await dbRun(`DELETE FROM galeria WHERE id = ?`, [galeriaId]);
      const galeria = await dbAll(`SELECT * FROM galeria WHERE partida_id = ?`, [partidaId]);
      socket.emit('galeria_actualizada', galeria);
    } catch (err) {
      console.error(err);
    }
  });

  // Guardado automático periódico
  socket.on('guardado_automatico', async ({ partidaId }) => {
    try {
      await dbRun(`UPDATE partidas SET fecha_modificacion = ? WHERE id = ?`, [new Date().toISOString(), partidaId]);
      socket.emit('guardado_confirmado');
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ Cliente desconectado: ${socket.id}`);
    
    // Remover usuario de la lista de conectados y notificar
    const { partidaId, usuarioId } = socket.data || {};
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

// Inicializar DB y Arrancar Servidor
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

initDb().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`
═════════════════════════════════════════════════════════════════
⚔️  VTT D&D 5e SERVER LISTENING ON http://${HOST}:${PORT}
🔮 Railway & Mobile Ready! 🎲
═════════════════════════════════════════════════════════════════
    `);
  });
}).catch(err => {
  console.error('Error fatal al iniciar la base de datos:', err);
});
