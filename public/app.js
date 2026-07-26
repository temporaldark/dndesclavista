/* ==========================================================================
   VTT D&D 5e - CLIENT CORE ENGINE (app.js)
   Manejo de Canvas, Drag & Drop (Mouse + Touch), Sockets, Dados, Chat y DM Tools
   ========================================================================== */

(function () {
  'use strict';

  // --- COLECCIÓN DE 20 GIFS TEMÁTICOS DE D&D ---
  const PRESET_GIFS = [
    { name: 'Dado d20 Crítico', url: 'https://media.giphy.com/media/3o7TKrEzvLbsVAud8I/giphy.gif', tag: 'dado' },
    { name: 'Dragón Fuego', url: 'https://media.giphy.com/media/l41YkFIiBxQdRlMnC/giphy.gif', tag: 'dragon' },
    { name: 'Mago Hechizo', url: 'https://media.giphy.com/media/l2Jhv95fOGznTSRZ6/giphy.gif', tag: 'mago' },
    { name: 'Guerrero Ataque', url: 'https://media.giphy.com/media/3oKIPkOgsH64rz0uPO/giphy.gif', tag: 'ataque' },
    { name: 'Fallo Pifia d20', url: 'https://media.giphy.com/media/26ufcVAp3AiJJsrIs/giphy.gif', tag: 'dado' },
    { name: 'Tesoro Cofre', url: 'https://media.giphy.com/media/3o6Mb5XDALv9c3qQeY/giphy.gif', tag: 'tesoro' },
    { name: 'Taberna Cerveza', url: 'https://media.giphy.com/media/l0HlHJGHe3yAMhdQY/giphy.gif', tag: 'taberna' },
    { name: 'Rogue Escondido', url: 'https://media.giphy.com/media/3o7TKTDn976rzVgky4/giphy.gif', tag: 'rogue' },
    { name: 'Orco Furia', url: 'https://media.giphy.com/media/l41Ye03sVz56VjPZC/giphy.gif', tag: 'monstruo' },
    { name: 'Curación Aura', url: 'https://media.giphy.com/media/3o7TKMt1VVNkHV2PaE/giphy.gif', tag: 'hechizo' },
    { name: 'Explosión Bola de Fuego', url: 'https://media.giphy.com/media/xT0Gqs2LQIevTVmjNm/giphy.gif', tag: 'fuego' },
    { name: 'Esqueleto Danza', url: 'https://media.giphy.com/media/QuxqWk7m9ffxyfoa0a/giphy.gif', tag: 'monstruo' },
    { name: 'D20 Rodando', url: 'https://media.giphy.com/media/xT9IgG50lhyPMOCURy/giphy.gif', tag: 'dado' },
    { name: 'Clérigo Luz', url: 'https://media.giphy.com/media/3o7TKpmf61254f14vC/giphy.gif', tag: 'hechizo' },
    { name: 'Mimic Cofre', url: 'https://media.giphy.com/media/3o7TKvhW3S7dJ4jEHu/giphy.gif', tag: 'monstruo' },
    { name: 'Iniciativa Combate', url: 'https://media.giphy.com/media/l0HlQXkh1wx1RjtUA/giphy.gif', tag: 'ataque' },
    { name: 'Risa DM Malvado', url: 'https://media.giphy.com/media/xl5QdxfNonh3q/giphy.gif', tag: 'dm' },
    { name: 'Victoria Nivel Up', url: 'https://media.giphy.com/media/l46CvkT8i3aQ2GjLi/giphy.gif', tag: 'victoria' },
    { name: 'Trampa Calabozo', url: 'https://media.giphy.com/media/3o6Zt62PeJedb4LQI8/giphy.gif', tag: 'trampa' },
    { name: 'Huida Correr', url: 'https://media.giphy.com/media/3o7ZetMrj4XA0S0Gre/giphy.gif', tag: 'huida' }
  ];

  // --- ESTADO GLOBAL CLIENTE ---
  let socket = null;
  let state = {
    partida: null,
    escenaActiva: null,
    escenas: [],
    fichas: [],
    figuras: [],
    dibujos: [],
    mensajes: [],
    historial: [],
    galeria: [],
    usuario: { id: null, nombre: '', esDM: false, color: '#c9a84c' }
  };
  
  let showHpBars = false;

  // Estado del Canvas VTT
  let canvas = null;
  let ctx = null;
  let mapImage = new Image();
  let mapImageLoaded = false;
  let tokenImagesCache = {};

  let viewport = {
    zoom: 1.0,
    panX: 0,
    panY: 0,
    tileSize: 50 // Pixeles por casilla base
  };

  let activeTool = 'move'; // 'move', 'measure', 'draw', 'erase', 'figures', 'healdamage'
  let selectedFichaId = null;
  let isDraggingToken = false;
  let dragOffset = { x: 0, y: 0 };
  let isDraggingFigure = false;
  let selectedFigureId = null;

  let isPanning = false;
  let panStart = { x: 0, y: 0 };

  // Medición
  let measureStart = null;
  let measureCurrent = null;

  // Dibujo
  let isDrawing = false;
  let currentStroke = [];

  // Figuras
  let figureStart = null;

  // Animaciones de dados en el mapa
  let activeDiceAnimations = []; // { fichaId, icono, resultado, startTime }

  // Paginación Historial
  let historyPage = 1;
  const historyPerPage = 10;

  // --- INICIALIZACIÓN ---
  window.addEventListener('DOMContentLoaded', () => {
    initDOM();
    initCanvas();
    initSocket();
    loadGamesList();
    setupAutoSave();
  });

  // --- ELEMENTOS DOM ---
  let dom = {};

  function initDOM() {
    dom = {
      // Pantallas
      screenStart: document.getElementById('screen-start'),
      screenVTT: document.getElementById('screen-vtt'),
      topNavbar: document.getElementById('top-navbar'),

      // Nav Info
      navGameTitle: document.getElementById('nav-game-title'),
      currentRoomCode: document.getElementById('current-room-code'),
      userRoleBadge: document.getElementById('user-role-badge'),
      userRoleText: document.getElementById('user-role-text'),
      currentSceneName: document.getElementById('current-scene-name'),
      saveStatusIndicator: document.getElementById('save-status-indicator'),
      btnNavInicio: document.getElementById('btn-nav-inicio'),
      btnMobileMenu: document.getElementById('btn-mobile-menu'),
      dmToolsPanel: document.getElementById('dm-tools-panel'),

      // Lista Partidas
      gamesList: document.getElementById('games-list'),
      btnCreateGameModal: document.getElementById('btn-create-game-modal'),
      btnJoinGameModal: document.getElementById('btn-join-game-modal'),

      // Canvas
      canvasWrapper: document.getElementById('canvas-wrapper'),
      canvasContainer: document.getElementById('vtt-canvas-container'),
      canvas: document.getElementById('vtt-canvas'),
      btnZoomIn: document.getElementById('btn-zoom-in'),
      btnZoomOut: document.getElementById('btn-zoom-out'),
      btnZoomReset: document.getElementById('btn-zoom-reset'),
      zoomLevelText: document.getElementById('zoom-level-text'),
      measureTooltip: document.getElementById('measure-tooltip'),

      // Herramientas DM
      toolButtons: document.querySelectorAll('.tool-btn'),
      toolOptionsContainer: document.getElementById('tool-options-container'),
      optDraw: document.getElementById('opt-draw'),
      optFigures: document.getElementById('opt-figures'),
      drawColor: document.getElementById('draw-color'),
      drawSize: document.getElementById('draw-size'),
      btnClearDrawings: document.getElementById('btn-clear-drawings'),
      figType: document.getElementById('fig-type'),
      figSize: document.getElementById('fig-size'),
      figColor: document.getElementById('fig-color'),
      figOpacity: document.getElementById('fig-opacity'),
      figLabel: document.getElementById('fig-label'),
      btnClearFigures: document.getElementById('btn-clear-figures'),

      // Pestañas Derechas
      tabButtons: document.querySelectorAll('.tab-btn'),
      tabPanes: document.querySelectorAll('.tab-pane'),
      fichasList: document.getElementById('fichas-list'),
      filterFichasInput: document.getElementById('filter-fichas-input'),
      btnOpenCreateFicha: document.getElementById('btn-open-create-ficha'),
      btnToggleHp: document.getElementById('btn-toggle-hp'),
      btnSortInitiative: document.getElementById('btn-sort-initiative'),

      // Dados
      diceFormulaInput: document.getElementById('dice-formula-input'),
      btnRollDice: document.getElementById('btn-roll-dice'),
      quickDiceButtons: document.querySelectorAll('.btn-quick-die'),
      classifButtons: document.querySelectorAll('.btn-classif'),
      modeButtons: document.querySelectorAll('.btn-mode'),
      diceTokenSelect: document.getElementById('dice-token-select'),
      quickDiceHistory: document.getElementById('quick-dice-history'),

      // Chat
      chatMessagesContainer: document.getElementById('chat-messages-container'),
      chatTextInput: document.getElementById('chat-text-input'),
      btnSendChat: document.getElementById('btn-send-chat'),
      btnOpenGifModal: document.getElementById('btn-open-gif-modal'),

      // Historial
      searchHistoryInput: document.getElementById('search-history-input'),
      historyTableBody: document.getElementById('history-table-body'),
      btnHistPrev: document.getElementById('btn-hist-prev'),
      btnHistNext: document.getElementById('btn-hist-next'),
      histPageInfo: document.getElementById('hist-page-info'),
      btnExportHistory: document.getElementById('btn-export-history'),
      btnClearHistory: document.getElementById('btn-clear-history'),

      // Panel DM
      scenesList: document.getElementById('scenes-list'),
      newSceneName: document.getElementById('new-scene-name'),
      btnCreateScene: document.getElementById('btn-create-scene'),
      mapFileInput: document.getElementById('map-file-input'),
      btnClearMapBg: document.getElementById('btn-clear-map-bg'),
      gridColsInput: document.getElementById('grid-cols-input'),
      gridRowsInput: document.getElementById('grid-rows-input'),
      gridFeetInput: document.getElementById('grid-feet-input'),
      btnApplyGrid: document.getElementById('btn-apply-grid'),
      btnSaveCurrentTemplate: document.getElementById('btn-save-current-template'),
      dmGalleryList: document.getElementById('dm-gallery-list'),

      // Modales
      modalFicha: document.getElementById('modal-ficha'),
      formFicha: document.getElementById('form-ficha'),
      modalFichaTitle: document.getElementById('modal-ficha-title'),
      fichaImgFile: document.getElementById('ficha-img-file'),
      fichaImagenUrl: document.getElementById('ficha-imagen-url'),
      fichaImgPreview: document.getElementById('ficha-img-preview'),

      modalDanoCuracion: document.getElementById('modal-dano-curacion'),
      hdTokenSelect: document.getElementById('hd-token-select'),
      hdAmountInput: document.getElementById('hd-amount-input'),
      btnApplyDamage: document.getElementById('btn-apply-damage'),
      btnApplyHeal: document.getElementById('btn-apply-heal'),

      modalGifPicker: document.getElementById('modal-gif-picker'),
      gifSearchInput: document.getElementById('gif-search-input'),
      gifGrid: document.getElementById('gif-grid'),
      modalGifView: document.getElementById('modal-gif-view'),
      enlargedGifImg: document.getElementById('enlarged-gif-img'),
      enlargedImgTitle: document.getElementById('enlarged-img-title'),

      modalCreateGame: document.getElementById('modal-create-game'),
      formCreateGame: document.getElementById('form-create-game'),
      modalJoinGame: document.getElementById('modal-join-game'),
      formJoinGame: document.getElementById('form-join-game'),

      codeBadge: document.getElementById('code-badge'),

      // Modales Revelado Avanzado
      modalRevelar: document.getElementById('modal-revelar-ficha'),
      revelarFichaId: document.getElementById('revelar-ficha-id'),
      revImagen: document.getElementById('rev-imagen'),
      revNombre: document.getElementById('rev-nombre'),
      revHp: document.getElementById('rev-hp'),
      revAc: document.getElementById('rev-ac'),
      revNotas: document.getElementById('rev-notas'),
      revJugadoresSelect: document.getElementById('rev-jugadores-select'),
      btnAplicarRevelado: document.getElementById('btn-aplicar-revelado')
    };

    setupEventListeners();
  }

  function getFichaVisibility(ficha) {
    if (state.usuario.esDM || ficha.tipo === 'jugador') {
      return { imagen: true, nombre: true, hp: true, ac: true, notas: true };
    }

    let config;
    try {
      config = JSON.parse(ficha.revelado);
    } catch(e) {
      const isRevealed = ficha.revelado === 1 || ficha.revelado === '1' || ficha.revelado === true;
      config = { global: { imagen: isRevealed, nombre: isRevealed, hp: isRevealed, ac: isRevealed, notas: isRevealed }, jugadores: {} };
    }

    if (!config || !config.global) {
      config = { global: { imagen: false, nombre: false, hp: false, ac: false, notas: false }, jugadores: {} };
    }

    const userId = state.usuario.id;
    const userConfig = config.jugadores?.[userId];
    
    return {
      imagen: userConfig?.imagen ?? config.global.imagen,
      nombre: userConfig?.nombre ?? config.global.nombre,
      hp: userConfig?.hp ?? config.global.hp,
      ac: userConfig?.ac ?? config.global.ac,
      notas: userConfig?.notas ?? config.global.notas,
    };
  }

  // --- SOCKET.IO EVENTOS ---
  function initSocket() {
    if (typeof io === 'undefined') {
      console.warn('Socket.io no está disponible aún. Esperando conexión.');
      return;
    }

    socket = io();

    socket.on('estado_inicial', (data) => {
      state.partida = data.partida;
      state.escenaActiva = data.escenaActiva;
      state.escenas = data.escenas || [];
      state.fichas = data.fichas || [];
      state.figuras = data.figuras || [];
      state.dibujos = data.dibujos || [];
      state.mensajes = data.mensajes || [];
      state.historial = data.historial || [];
      state.galeria = data.galeria || [];
      state.usuario = data.usuario;

      // Generar usuario id local si no existía
      if (!state.usuario.id) {
        state.usuario.id = 'usr_' + Math.random().toString(36).substr(2, 9);
      }

      updateUIForCurrentGame();
      showScreen('vtt');
      if (state.escenaActiva && state.escenaActiva.mapa) {
        loadMapImage(state.escenaActiva.mapa);
      } else {
        renderCanvas();
      }
    });

    socket.on('error_partida', (msg) => {
      alert('❌ Error: ' + msg);
    });

    socket.on('escena_cambiada', ({ escenaActiva, figuras, dibujos }) => {
      state.escenaActiva = escenaActiva;
      state.figuras = figuras || [];
      state.dibujos = dibujos || [];
      if (dom.currentSceneName) dom.currentSceneName.textContent = escenaActiva.nombre;
      loadMapImage(escenaActiva.mapa);
      renderCanvas();
    });

    socket.on('escenas_actualizadas', (escenas) => {
      state.escenas = escenas || [];
      renderScenesList();
    });

    socket.on('mapa_actualizado', ({ escenaId, mapa }) => {
      if (state.escenaActiva && state.escenaActiva.id === escenaId) {
        state.escenaActiva.mapa = mapa;
        loadMapImage(mapa);
        renderCanvas();
      }
    });

    socket.on('grid_actualizado', ({ gridX, gridY, casilla }) => {
      if (state.partida) {
        state.partida.config_grid_x = gridX;
        state.partida.config_grid_y = gridY;
        state.partida.config_casilla = casilla;
        renderCanvas();
      }
    });

    socket.on('ficha_movida', ({ fichaId, x, y }) => {
      const ficha = state.fichas.find(f => f.id === fichaId);
      if (ficha) {
        ficha.x = x;
        ficha.y = y;
        renderCanvas();
      }
    });

    socket.on('ficha_creada', (nuevaFicha) => {
      state.fichas.push(nuevaFicha);
      renderFichasList();
      renderTokenSelects();
      renderCanvas();
    });

    socket.on('ficha_actualizada', (fichaActualizada) => {
      const idx = state.fichas.findIndex(f => f.id === fichaActualizada.id);
      if (idx !== -1) {
        state.fichas[idx] = fichaActualizada;
        renderFichasList();
        renderTokenSelects();
        renderCanvas();
      }
    });

    socket.on('gigante_toggled', ({ fichaId, gigante }) => {
      const ficha = state.fichas.find(f => f.id === fichaId);
      if (ficha) {
        ficha.gigante = !!gigante;
        renderCanvas();
        renderFichasList();
      }
    });

    socket.on('revelado_toggled', ({ fichaId, revelado }) => {
      const ficha = state.fichas.find(f => f.id === fichaId);
      if (ficha) {
        ficha.revelado = revelado; // es string JSON
        renderCanvas();
        renderFichasList();
      }
    });

    socket.on('ficha_eliminada', (fichaId) => {
      state.fichas = state.fichas.filter(f => f.id !== fichaId);
      renderFichasList();
      renderTokenSelects();
      renderCanvas();
    });

    socket.on('hp_actualizado', ({ fichaId, hp_actual }) => {
      const ficha = state.fichas.find(f => f.id === fichaId);
      if (ficha) {
        ficha.hp_actual = hp_actual;
        renderFichasList();
        renderCanvas();
      }
    });

    socket.on('figuras_actualizadas', (figuras) => {
      state.figuras = figuras || [];
      renderCanvas();
    });

    socket.on('dibujos_actualizados', (dibujos) => {
      state.dibujos = dibujos || [];
      renderCanvas();
    });

    socket.on('nuevo_mensaje', (msg) => {
      state.mensajes.push(msg);
      renderChatMessage(msg);
      scrollChatToBottom();
    });

    socket.on('nueva_tirada', (reg) => {
      state.historial.unshift(reg);
      renderHistoryTable();
      renderQuickHistory();
    });

    socket.on('animacion_dado_ficha', ({ fichaId, icono, resultado }) => {
      activeDiceAnimations.push({
        fichaId,
        icono,
        resultado,
        startTime: Date.now()
      });
      requestAnimationFrame(animateLoop);
    });

    socket.on('historial_limpiado', () => {
      state.historial = [];
      renderHistoryTable();
      renderQuickHistory();
    });

    socket.on('galeria_actualizada', (galeria) => {
      state.galeria = galeria || [];
      renderGalleryChips();
    });

    socket.on('guardado_confirmado', () => {
      showSaveIndicator('✅ Guardado');
    });
  }

  // --- CANVAS & VTT ENGINE ---
  function initCanvas() {
    canvas = dom.canvas;
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resizeCanvas();

    window.addEventListener('resize', resizeCanvas);

    // Eventos de Mouse
    dom.canvasContainer.addEventListener('mousedown', handleMouseDown);
    dom.canvasContainer.addEventListener('mousemove', handleMouseMove);
    dom.canvasContainer.addEventListener('mouseup', handleMouseUp);
    dom.canvasContainer.addEventListener('mouseleave', handleMouseUp);
    dom.canvasContainer.addEventListener('wheel', handleWheel, { passive: false });

    // Eventos Táctiles Móvil (Touch)
    dom.canvasContainer.addEventListener('touchstart', handleTouchStart, { passive: false });
    dom.canvasContainer.addEventListener('touchmove', handleTouchMove, { passive: false });
    dom.canvasContainer.addEventListener('touchend', handleTouchEnd, { passive: false });
  }

  function resizeCanvas() {
    if (!dom.canvasWrapper || !canvas) return;
    canvas.width = dom.canvasWrapper.clientWidth;
    canvas.height = dom.canvasWrapper.clientHeight;
    renderCanvas();
  }

  function loadMapImage(src) {
    if (!src) {
      mapImageLoaded = false;
      mapImage.src = '';
      return;
    }
    mapImage = new Image();
    mapImage.onload = () => {
      mapImageLoaded = true;
      renderCanvas();
    };
    mapImage.src = src;
  }

  function getTileSize() {
    return viewport.tileSize * viewport.zoom;
  }

  // Transforma coordenadas de pantalla a casillas del grid
  function screenToGrid(screenX, screenY) {
    const rect = canvas.getBoundingClientRect();
    const x = (screenX - rect.left - viewport.panX) / getTileSize();
    const y = (screenY - rect.top - viewport.panY) / getTileSize();
    return { x, y };
  }

  // Renderizado Principal del Tablero
  function renderCanvas() {
    if (!ctx || !canvas) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cols = state.partida?.config_grid_x || 40;
    const rows = state.partida?.config_grid_y || 40;
    const tileSize = getTileSize();

    ctx.save();
    ctx.translate(viewport.panX, viewport.panY);

    const mapWidth = cols * tileSize;
    const mapHeight = rows * tileSize;

    // 1. Dibujar Imagen de Mapa de Fondo
    if (mapImageLoaded && mapImage.src) {
      ctx.drawImage(mapImage, 0, 0, mapWidth, mapHeight);
    } else {
      // Fondo oscuro por defecto
      ctx.fillStyle = '#0d0d22';
      ctx.fillRect(0, 0, mapWidth, mapHeight);
    }

    // 2. Dibujar Grid de Casillas
    ctx.strokeStyle = 'rgba(201, 168, 76, 0.18)';
    ctx.lineWidth = 1;

    for (let c = 0; c <= cols; c++) {
      ctx.beginPath();
      ctx.moveTo(c * tileSize, 0);
      ctx.lineTo(c * tileSize, mapHeight);
      ctx.stroke();
    }

    for (let r = 0; r <= rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * tileSize);
      ctx.lineTo(mapWidth, r * tileSize);
      ctx.stroke();
    }

    // 3. Dibujar Trazos de Dibujo del DM
    if (state.dibujos && state.dibujos.length > 0) {
      state.dibujos.forEach(stroke => {
        if (stroke.points && stroke.points.length > 1) {
          ctx.strokeStyle = stroke.color || '#e74c3c';
          ctx.lineWidth = stroke.size || 4;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(stroke.points[0].x * tileSize, stroke.points[0].y * tileSize);
          for (let i = 1; i < stroke.points.length; i++) {
            ctx.lineTo(stroke.points[i].x * tileSize, stroke.points[i].y * tileSize);
          }
          ctx.stroke();
        }
      });
    }

    // Dibujar trazo en curso
    if (isDrawing && currentStroke.length > 1) {
      ctx.strokeStyle = dom.drawColor.value;
      ctx.lineWidth = parseInt(dom.drawSize.value);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(currentStroke[0].x * tileSize, currentStroke[0].y * tileSize);
      for (let i = 1; i < currentStroke.length; i++) {
        ctx.lineTo(currentStroke[i].x * tileSize, currentStroke[i].y * tileSize);
      }
      ctx.stroke();
    }

    // 4. Dibujar Figuras Geométricas (Áreas de Efecto)
    if (state.figuras && state.figuras.length > 0) {
      state.figuras.forEach(fig => {
        const centerX = fig.x * tileSize;
        const centerY = fig.y * tileSize;
        const radius = fig.tamanio * tileSize;

        ctx.save();
        ctx.globalAlpha = fig.transparencia || 0.4;
        ctx.fillStyle = fig.color || '#c9a84c';
        ctx.strokeStyle = fig.color || '#c9a84c';
        ctx.lineWidth = 2;

        if (fig.tipo === 'circulo') {
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (fig.tipo === 'cuadrado') {
          ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
          ctx.strokeRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
        } else if (fig.tipo === 'cono') {
          ctx.beginPath();
          ctx.moveTo(centerX, centerY);
          ctx.arc(centerX, centerY, radius, -Math.PI / 4, Math.PI / 4);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }

        // Etiqueta de la figura
        if (fig.etiqueta) {
          ctx.globalAlpha = 1.0;
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 12px Roboto';
          ctx.textAlign = 'center';
          ctx.fillText(fig.etiqueta, centerX, centerY);
        }
        ctx.restore();
      });
    }

    // 5. Dibujar Fichas / Tokens de Personaje
    (state.fichas || []).forEach(ficha => {
      const isMonster = ficha.tipo === 'monstruo' || ficha.tipo === 'npc';
      const isPlayerView = !state.usuario.esDM;
      const visibility = getFichaVisibility(ficha);

      // Calcular multiplicador de tamaño (Gigante = x2)
      let scaleMult = 1;
      if (ficha.tamanio_base === 'grande') scaleMult = 2;
      if (ficha.tamanio_base === 'enorme') scaleMult = 3;
      if (ficha.gigante) scaleMult *= 2;

      const tokenWidth = tileSize * scaleMult;
      const tokenHeight = tileSize * scaleMult;
      const px = ficha.x * tileSize;
      const py = ficha.y * tileSize;

      ctx.save();

      // Borde exterior / resplandor si está seleccionada
      if (ficha.id === selectedFichaId) {
        ctx.strokeStyle = '#f0d060';
        ctx.lineWidth = 4;
        ctx.shadowColor = '#f0d060';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(px + tokenWidth / 2, py + tokenHeight / 2, tokenWidth / 2 + 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Dibujar Imagen o Avatar del Token
      const radius = tokenWidth / 2;
      const cx = px + radius;
      const cy = py + radius;

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.clip();

      if (isMonster && isPlayerView && !visibility.imagen) {
        // Silueta misteriosa para jugadores ante monstruos no revelados
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(px, py, tokenWidth, tokenHeight);
        ctx.fillStyle = '#c9a84c';
        ctx.font = `bold ${Math.max(14, tokenWidth * 0.4)}px Roboto`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('❓', cx, cy);
      } else if (ficha.imagen) {
        let img = tokenImagesCache[ficha.imagen];
        if (!img) {
          img = new Image();
          img.src = ficha.imagen;
          tokenImagesCache[ficha.imagen] = img;
          img.onload = () => renderCanvas();
        }
        if (img.complete && img.naturalWidth !== 0) {
          ctx.drawImage(img, px, py, tokenWidth, tokenHeight);
        } else {
          drawFallbackToken(ctx, px, py, tokenWidth, tokenHeight, ficha);
        }
      } else {
        drawFallbackToken(ctx, px, py, tokenWidth, tokenHeight, ficha);
      }

      ctx.restore();

      // Dibujar Borde Dorado del Token
      ctx.strokeStyle = '#c9a84c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      // Floating HP Bar & Floating Name
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px Roboto';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#000000';
      ctx.shadowBlur = 4;
      const displayName = (isMonster && isPlayerView && !visibility.nombre) ? '???' : ficha.nombre;

      // Usar hp visibility para la barra de vida
      const showBar = showHpBars && (!isMonster || !isPlayerView || visibility.hp);
      if (showBar) {
        const hpPercent = Math.max(0, Math.min(1, ficha.hp_actual / (ficha.hp_maximo || 1)));
        const barW = Math.max(40, tokenWidth);
        const barH = 6;
        const barX = cx - barW / 2;
        const barY = py - 16;

        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = hpPercent > 0.5 ? '#2ecc71' : hpPercent > 0.25 ? '#f1c40f' : '#e74c3c';
        ctx.fillRect(barX, barY, barW * hpPercent, barH);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.strokeRect(barX, barY, barW, barH);

        // Nombre encima de la barra
        ctx.fillStyle = '#ffffff';
        ctx.fillText(displayName, cx, py - 22);
      } else {
        // Solo nombre, sin barra
        ctx.fillText(displayName, cx, py - 6);
      }
      ctx.restore();

      // Animaciones de Dados Flotantes sobre la ficha
      const anim = activeDiceAnimations.find(a => a.fichaId === ficha.id);
      if (anim) {
        const elapsed = Date.now() - anim.startTime;
        if (elapsed < 2500) {
          ctx.save();
          ctx.font = 'bold 22px Roboto';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#f0d060';
          ctx.shadowColor = '#000';
          ctx.shadowBlur = 8;
          ctx.fillText(`${anim.icono} ${anim.resultado}`, cx, py - 30 - (elapsed * 0.015));
          ctx.restore();
        }
      }
    });

    // 6. Línea de Medición de Distancia
    if (activeTool === 'measure' && measureStart && measureCurrent) {
      const x1 = measureStart.x * tileSize;
      const y1 = measureStart.y * tileSize;
      const x2 = measureCurrent.x * tileSize;
      const y2 = measureCurrent.y * tileSize;

      ctx.strokeStyle = '#f0d060';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Distancia en casillas y pies
      const distTiles = Math.hypot(measureCurrent.x - measureStart.x, measureCurrent.y - measureStart.y);
      const feetPerTile = state.partida?.config_casilla || 5;
      const totalFeet = Math.round(distTiles * feetPerTile);

      ctx.fillStyle = '#f0d060';
      ctx.font = 'bold 14px Roboto';
      ctx.textAlign = 'center';
      ctx.fillText(`${totalFeet} ft`, (x1 + x2) / 2, (y1 + y2) / 2 - 10);
    }

    ctx.restore();
  }

  function drawFallbackToken(ctx, px, py, w, h, ficha) {
    ctx.fillStyle = ficha.tipo === 'monstruo' ? '#c0392b' : ficha.tipo === 'npc' ? '#8e44ad' : '#2980b9';
    ctx.fillRect(px, py, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.max(14, w * 0.4)}px Roboto`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((ficha.nombre || '?').charAt(0).toUpperCase(), px + w / 2, py + h / 2);
  }

  function animateLoop() {
    renderCanvas();
    activeDiceAnimations = activeDiceAnimations.filter(a => Date.now() - a.startTime < 2500);
    if (activeDiceAnimations.length > 0) {
      requestAnimationFrame(animateLoop);
    }
  }

  let lastMoveEmitTime = 0;

  // --- MANEJADORES DE EVENTOS MOUSE / TOUCH EN CANVAS ---
  function handleMouseDown(e) {
    const gridPos = screenToGrid(e.clientX, e.clientY);

    if (activeTool === 'move') {
      // Buscar si hizo clic sobre alguna ficha
      const clickedFicha = [...(state.fichas || [])].reverse().find(f => {
        let mult = f.tamanio_base === 'grande' ? 2 : f.tamanio_base === 'enorme' ? 3 : 1;
        if (f.gigante) mult *= 2;
        return gridPos.x >= f.x && gridPos.x <= f.x + mult && gridPos.y >= f.y && gridPos.y <= f.y + mult;
      });

      if (clickedFicha) {
        // Verificar permisos: DM o dueño directo de la ficha
        const esDuenio = state.usuario.esDM || 
                         clickedFicha.jugador_id === state.usuario.id ||
                         (!clickedFicha.jugador_id && clickedFicha.tipo === 'jugador');
        if (esDuenio) {
          selectedFichaId = clickedFicha.id;
          isDraggingToken = true;
          dragOffset = { x: gridPos.x - clickedFicha.x, y: gridPos.y - clickedFicha.y };
          renderFichasList();
          renderCanvas();
          return;
        }
      }

      // Buscar si hizo clic en figura
      const clickedFig = (state.figuras || []).find(fig => {
        return gridPos.x >= fig.x - (fig.tamanio || 1) && gridPos.x <= fig.x + (fig.tamanio || 1) &&
               gridPos.y >= fig.y - (fig.tamanio || 1) && gridPos.y <= fig.y + (fig.tamanio || 1);
      });

      if (clickedFig) {
        selectedFigureId = clickedFig.id;
        isDraggingFigure = true;
        dragOffset = { x: gridPos.x - clickedFig.x, y: gridPos.y - clickedFig.y };
        return;
      }

      // Si no hizo clic en ficha ni figura, iniciar Pan de cámara
      isPanning = true;
      panStart = { x: e.clientX - viewport.panX, y: e.clientY - viewport.panY };
    } else if (activeTool === 'measure') {
      measureStart = gridPos;
      measureCurrent = gridPos;
    } else if (activeTool === 'draw' && state.usuario.esDM) {
      isDrawing = true;
      currentStroke = [{ x: gridPos.x, y: gridPos.y }];
    } else if (activeTool === 'figures') {
      figureStart = gridPos;
      const nuevaFig = {
        id: 'fig_' + Math.random().toString(36).substr(2, 9),
        tipo: dom.figType.value,
        x: Math.round(gridPos.x),
        y: Math.round(gridPos.y),
        tamanio: parseFloat(dom.figSize.value),
        color: dom.figColor.value,
        transparencia: parseFloat(dom.figOpacity.value),
        etiqueta: dom.figLabel.value,
        creador_id: state.usuario.id
      };
      socket?.emit('guardar_figura', { partidaId: state.partida.id, escenaId: state.escenaActiva.id, figuraData: nuevaFig });
    } else if (activeTool === 'erase') {
      // Borrar figura o trazo en ese punto (Dueño o DM)
      const figToDel = (state.figuras || []).find(fig => 
        (fig.creador_id === state.usuario.id || state.usuario.esDM) &&
        Math.hypot(fig.x - gridPos.x, fig.y - gridPos.y) <= fig.tamanio
      );
      if (figToDel) {
        socket?.emit('eliminar_figura', { partidaId: state.partida.id, escenaId: state.escenaActiva.id, figuraId: figToDel.id });
      }
    }
  }

  function handleMouseMove(e) {
    const gridPos = screenToGrid(e.clientX, e.clientY);

    if (isDraggingToken && selectedFichaId) {
      const ficha = state.fichas.find(f => f.id === selectedFichaId);
      if (ficha) {
        ficha.x = gridPos.x - dragOffset.x;
        ficha.y = gridPos.y - dragOffset.y;
        renderCanvas();

        // Emitir posición en tiempo real a la sala (throttled cada 40ms)
        const now = Date.now();
        if (now - lastMoveEmitTime > 40) {
          lastMoveEmitTime = now;
          socket?.emit('mover_ficha', {
            partidaId: state.partida.id,
            escenaId: state.escenaActiva.id,
            fichaId: ficha.id,
            x: ficha.x,
            y: ficha.y
          });
        }
      }
    } else if (isDraggingFigure && selectedFigureId) {
      const fig = state.figuras.find(f => f.id === selectedFigureId);
      if (fig) {
        fig.x = gridPos.x - dragOffset.x;
        fig.y = gridPos.y - dragOffset.y;
        renderCanvas();
      }
    } else if (isPanning) {
      viewport.panX = e.clientX - panStart.x;
      viewport.panY = e.clientY - panStart.y;
      renderCanvas();
    } else if (activeTool === 'measure' && measureStart) {
      measureCurrent = gridPos;
      renderCanvas();
    } else if (isDrawing && activeTool === 'draw' && state.usuario.esDM) {
      currentStroke.push({ x: gridPos.x, y: gridPos.y });
      renderCanvas();
    }
  }

  function handleMouseUp() {
    if (isDraggingToken && selectedFichaId) {
      const ficha = state.fichas.find(f => f.id === selectedFichaId);
      if (ficha) {
        // Snap al grid en números enteros más cercanos
        ficha.x = Math.round(ficha.x);
        ficha.y = Math.round(ficha.y);
        socket?.emit('mover_ficha', {
          partidaId: state.partida.id,
          escenaId: state.escenaActiva.id,
          fichaId: ficha.id,
          x: ficha.x,
          y: ficha.y
        });
      }
    }

    if (isDraggingFigure && selectedFigureId) {
      const fig = state.figuras.find(f => f.id === selectedFigureId);
      if (fig) {
        fig.x = Math.round(fig.x);
        fig.y = Math.round(fig.y);
        socket?.emit('guardar_figura', {
          partidaId: state.partida.id,
          escenaId: state.escenaActiva.id,
          figuraData: fig
        });
      }
      isDraggingFigure = false;
      selectedFigureId = null;
      renderCanvas();
    }

    if (isDrawing && currentStroke.length > 1) {
      state.dibujos.push({
        color: dom.drawColor.value,
        size: parseInt(dom.drawSize.value),
        points: currentStroke
      });
      socket?.emit('guardar_dibujos', {
        partidaId: state.partida.id,
        escenaId: state.escenaActiva.id,
        datos: state.dibujos
      });
    }

    isDraggingToken = false;
    isPanning = false;
    measureStart = null;
    measureCurrent = null;
    isDrawing = false;
    currentStroke = [];
    renderCanvas();
  }

  function handleWheel(e) {
    e.preventDefault();
    const gridPos = screenToGrid(e.clientX, e.clientY);
    const myFig = (state.figuras || []).find(fig => 
      (fig.creador_id === state.usuario.id || state.usuario.esDM) && 
      Math.hypot(fig.x - gridPos.x, fig.y - gridPos.y) <= fig.tamanio
    );

    if (myFig) {
      const scale = e.deltaY < 0 ? 1.1 : 0.9;
      myFig.tamanio = Math.max(0.5, myFig.tamanio * scale);
      socket?.emit('guardar_figura', { 
        partidaId: state.partida.id, 
        escenaId: state.escenaActiva.id, 
        figuraData: myFig 
      });
      renderCanvas();
      return;
    }

    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    zoomAt(e.clientX, e.clientY, zoomFactor);
  }

  function zoomAt(screenX, screenY, factor) {
    const newZoom = Math.max(0.3, Math.min(4.0, viewport.zoom * factor));
    const rect = canvas.getBoundingClientRect();
    const mouseX = screenX - rect.left;
    const mouseY = screenY - rect.top;

    viewport.panX = mouseX - (mouseX - viewport.panX) * (newZoom / viewport.zoom);
    viewport.panY = mouseY - (mouseY - viewport.panY) * (newZoom / viewport.zoom);
    viewport.zoom = newZoom;

    if (dom.zoomLevelText) dom.zoomLevelText.textContent = `${Math.round(viewport.zoom * 100)}%`;
    renderCanvas();
  }

  // SOPORTE EVENTOS TÁCTILES MÓVIL
  let touchStartDist = 0;

  function handleTouchStart(e) {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      handleMouseDown({ clientX: touch.clientX, clientY: touch.clientY });
    } else if (e.touches.length === 2) {
      touchStartDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }

  function handleTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      handleMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
    } else if (e.touches.length === 2) {
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const gridPos = screenToGrid(midX, midY);
      
      const myFig = (state.figuras || []).find(fig => 
        (fig.creador_id === state.usuario.id || state.usuario.esDM) && 
        Math.hypot(fig.x - gridPos.x, fig.y - gridPos.y) <= fig.tamanio
      );

      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const factor = dist / touchStartDist;
      touchStartDist = dist;

      if (myFig) {
        myFig.tamanio = Math.max(0.5, myFig.tamanio * factor);
        socket?.emit('guardar_figura', { 
          partidaId: state.partida.id, 
          escenaId: state.escenaActiva.id, 
          figuraData: myFig 
        });
        renderCanvas();
      } else {
        zoomAt(midX, midY, factor);
      }
    }
  }

  function handleTouchEnd(e) {
    handleMouseUp();
  }

  // --- REGISTRO DE EVENT LISTENERS DOM ---
  function setupEventListeners() {
    dom.btnToggleHp?.addEventListener('click', () => {
      showHpBars = !showHpBars;
      dom.btnToggleHp.classList.toggle('active', showHpBars);
      dom.btnToggleHp.title = showHpBars ? 'Ocultar Barras de HP' : 'Mostrar Barras de HP';
      renderCanvas();
    });

    dom.btnSortInitiative?.addEventListener('click', () => {
      if (state.fichas) {
        state.fichas.sort((a, b) => (b.iniciativa || 0) - (a.iniciativa || 0));
        renderFichasList();
      }
    });

    // Menús y Navegación & Botones Inicio
    dom.btnNavInicio.addEventListener('click', () => {
      autoSaveGame();
      loadGamesList();
      showScreen('start');
    });

    if (dom.codeBadge) {
      dom.codeBadge.addEventListener('click', () => {
        if (state.partida?.codigo) {
          navigator.clipboard.writeText(state.partida.codigo);
          alert(`📋 Código ${state.partida.codigo} copiado al portapapeles!`);
        }
      });
    }

    if (dom.btnMobileMenu) {
      dom.btnMobileMenu.addEventListener('click', () => {
        dom.dmToolsPanel.classList.toggle('open');
      });
    }

    // Modal Crear / Unirse a Partida
    dom.btnCreateGameModal.addEventListener('click', () => openModal(dom.modalCreateGame));
    dom.btnJoinGameModal.addEventListener('click', () => openModal(dom.modalJoinGame));

    dom.formCreateGame.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombre = document.getElementById('new-game-name').value;
      const cols = parseInt(document.getElementById('new-game-cols').value) || 40;
      const rows = parseInt(document.getElementById('new-game-rows').value) || 40;

      try {
        const res = await fetch('/api/partidas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre, configGridX: cols, configGridY: rows })
        });
        const data = await res.json();
        closeModal(dom.modalCreateGame);

        // Unirse automáticamente como DM
        const usrId = 'dm_' + Math.random().toString(36).substr(2, 9);
        socket?.emit('unirse_partida', { codigo: data.codigo, nombreUsuario: 'Dungeon Master', usuarioId: usrId, esDMRequested: true });
      } catch (err) {
        alert('Error al crear la partida.');
      }
    });

    dom.formJoinGame.addEventListener('submit', (e) => {
      e.preventDefault();
      const codigo = document.getElementById('join-code-input').value;
      const nombreUsuario = document.getElementById('join-username-input').value;
      const usrId = 'usr_' + Math.random().toString(36).substr(2, 9);

      closeModal(dom.modalJoinGame);
      socket?.emit('unirse_partida', { codigo, nombreUsuario, usuarioId: usrId, esDMRequested: false });
    });

    // Herramientas DM (Panel Izquierdo)
    dom.toolButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        dom.toolButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeTool = btn.dataset.tool;

        // Mostrar opciones de sub-herramienta
        dom.toolOptionsContainer.classList.add('hidden');
        dom.optDraw.classList.add('hidden');
        dom.optFigures.classList.add('hidden');

        if (activeTool === 'draw') {
          dom.toolOptionsContainer.classList.remove('hidden');
          dom.optDraw.classList.remove('hidden');
        } else if (activeTool === 'figures') {
          dom.toolOptionsContainer.classList.remove('hidden');
          dom.optFigures.classList.remove('hidden');
        } else if (activeTool === 'healdamage') {
          openModal(dom.modalDanoCuracion);
        }
      });
    });

    dom.btnClearDrawings.addEventListener('click', () => {
      socket?.emit('limpiar_dibujos', { partidaId: state.partida.id, escenaId: state.escenaActiva.id });
    });

    dom.btnClearFigures.addEventListener('click', () => {
      socket?.emit('limpiar_figuras', { partidaId: state.partida.id, escenaId: state.escenaActiva.id });
    });

    // Zoom flotante
    dom.btnZoomIn.addEventListener('click', () => zoomAt(canvas.width / 2, canvas.height / 2, 1.2));
    dom.btnZoomOut.addEventListener('click', () => zoomAt(canvas.width / 2, canvas.height / 2, 0.8));
    dom.btnZoomReset.addEventListener('click', () => {
      viewport.zoom = 1.0;
      viewport.panX = 0;
      viewport.panY = 0;
      if (dom.zoomLevelText) dom.zoomLevelText.textContent = '100%';
      renderCanvas();
    });

    // Pestañas Derechas
    dom.tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        dom.tabButtons.forEach(b => b.classList.remove('active'));
        dom.tabPanes.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const targetPane = document.getElementById(btn.dataset.tab);
        if (targetPane) targetPane.classList.add('active');
      });
    });

    // Fichas
    dom.btnOpenCreateFicha.addEventListener('click', () => {
      dom.formFicha.reset();
      document.getElementById('ficha-id').value = '';
      dom.fichaImgPreview.src = 'https://via.placeholder.com/100?text=Avatar';
      dom.modalFichaTitle.textContent = 'Crear Nueva Ficha de Personaje';

      // Ocultar opciones de NPC/Monstruo si no es DM
      const fichaTipo = document.getElementById('ficha-tipo');
      Array.from(fichaTipo.options).forEach(opt => {
        if (!state.usuario.esDM && opt.value !== 'jugador') {
          opt.style.display = 'none';
        } else {
          opt.style.display = '';
        }
      });
      if (!state.usuario.esDM) fichaTipo.value = 'jugador';

      openModal(dom.modalFicha);
    });

    dom.fichaImgFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          dom.fichaImgPreview.src = evt.target.result;
        };
        reader.readAsDataURL(file);
      }
    });

    dom.fichaImagenUrl.addEventListener('input', (e) => {
      if (e.target.value) dom.fichaImgPreview.src = e.target.value;
    });

    dom.formFicha.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = document.getElementById('ficha-id').value;
      const fichaData = {
        id: id || undefined,
        nombre: document.getElementById('ficha-nombre').value,
        tipo: document.getElementById('ficha-tipo').value,
        jugadorId: state.usuario.id,
        imagen: dom.fichaImgPreview.src,
        fuerza: parseInt(document.getElementById('ficha-fue').value) || 10,
        destreza: parseInt(document.getElementById('ficha-des').value) || 10,
        constitucion: parseInt(document.getElementById('ficha-con').value) || 10,
        inteligencia: parseInt(document.getElementById('ficha-int').value) || 10,
        sabiduria: parseInt(document.getElementById('ficha-sab').value) || 10,
        carisma: parseInt(document.getElementById('ficha-car').value) || 10,
        hpActual: parseInt(document.getElementById('ficha-hp-act').value) || 10,
        hpMaximo: parseInt(document.getElementById('ficha-hp-max').value) || 10,
        hp_actual: parseInt(document.getElementById('ficha-hp-act').value) || 10,
        hp_maximo: parseInt(document.getElementById('ficha-hp-max').value) || 10,
        ac: parseInt(document.getElementById('ficha-ac').value) || 10,
        velocidad: parseInt(document.getElementById('ficha-vel').value) || 30,
        iniciativa: parseInt(document.getElementById('ficha-ini').value) || 0,
        nivel: parseInt(document.getElementById('ficha-nivel').value) || 1,
        altura: parseInt(document.getElementById('ficha-altura').value) || 2,
        tamanioBase: document.getElementById('ficha-tamanio').value,
        tamanio_base: document.getElementById('ficha-tamanio').value,
        notas: document.getElementById('ficha-notas').value
      };

      if (id) {
        socket?.emit('actualizar_ficha', { partidaId: state.partida.id, fichaData });
      } else {
        socket?.emit('crear_ficha', { partidaId: state.partida.id, escenaId: state.escenaActiva.id, fichaData });
      }

      closeModal(dom.modalFicha);
    });

    // Lanzador de Dados
    dom.quickDiceButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        dom.diceFormulaInput.value = btn.dataset.die;
      });
    });

    dom.classifButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        dom.classifButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    dom.modeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        dom.modeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    dom.btnRollDice.addEventListener('click', rollDice);

    // Chat
    dom.btnSendChat.addEventListener('click', sendChatMessage);
    dom.chatTextInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendChatMessage();
    });

    dom.btnOpenGifModal.addEventListener('click', () => {
      renderGifGrid(PRESET_GIFS);
      openModal(dom.modalGifPicker);
    });

    dom.gifSearchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = PRESET_GIFS.filter(g => g.name.toLowerCase().includes(q) || g.tag.toLowerCase().includes(q));
      renderGifGrid(filtered);
    });

    // Historial
    dom.btnHistPrev.addEventListener('click', () => {
      if (historyPage > 1) {
        historyPage--;
        renderHistoryTable();
      }
    });

    dom.btnHistNext.addEventListener('click', () => {
      if (historyPage * historyPerPage < (state.historial || []).length) {
        historyPage++;
        renderHistoryTable();
      }
    });

    dom.searchHistoryInput.addEventListener('input', renderHistoryTable);

    dom.btnExportHistory.addEventListener('click', () => {
      if (state.partida?.id) {
        window.location.href = `/api/partidas/${state.partida.id}/export`;
      }
    });

    dom.btnClearHistory.addEventListener('click', () => {
      if (confirm('¿Limpiar todo el historial de tiradas de la partida?')) {
        socket?.emit('limpiar_historial', { partidaId: state.partida.id });
      }
    });

    // Panel DM
    dom.btnCreateScene.addEventListener('click', () => {
      const nombre = dom.newSceneName.value.trim();
      if (nombre) {
        socket?.emit('crear_escena', { partidaId: state.partida.id, nombre });
        dom.newSceneName.value = '';
      }
    });

    // Botón visible que dispara el input oculto de subida de mapa
    const btnTriggerMap = document.getElementById('btn-trigger-map-upload');
    if (btnTriggerMap) {
      btnTriggerMap.addEventListener('click', () => {
        dom.mapFileInput.click();
      });
    }

    dom.mapFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          const img = new Image();
          img.onload = () => {
             const canvas = document.createElement('canvas');
             let w = img.width;
             let h = img.height;
             const MAX_DIM = 2048; 
             if (w > MAX_DIM || h > MAX_DIM) {
               if (w > h) { h = Math.round((h * MAX_DIM) / w); w = MAX_DIM; }
               else { w = Math.round((w * MAX_DIM) / h); h = MAX_DIM; }
             }
             canvas.width = w; canvas.height = h;
             const ctx = canvas.getContext('2d');
             ctx.drawImage(img, 0, 0, w, h);
             const resizedBase64 = canvas.toDataURL('image/jpeg', 0.85);
             
             socket?.emit('actualizar_mapa', { partidaId: state.partida.id, escenaId: state.escenaActiva.id, mapaBase64: resizedBase64 });
          };
          img.src = evt.target.result;
        };
        reader.readAsDataURL(file);
      }
    });

    dom.btnClearMapBg.addEventListener('click', () => {
      socket?.emit('actualizar_mapa', { partidaId: state.partida.id, escenaId: state.escenaActiva.id, mapaBase64: null });
    });

    dom.btnApplyGrid.addEventListener('click', () => {
      const gridX = parseInt(dom.gridColsInput.value) || 40;
      const gridY = parseInt(dom.gridRowsInput.value) || 40;
      const casilla = parseInt(dom.gridFeetInput.value) || 5;

      socket?.emit('actualizar_grid', { partidaId: state.partida.id, gridX, gridY, casilla });
    });

    dom.btnSaveCurrentTemplate.addEventListener('click', () => {
      if (!selectedFichaId) {
        alert('Por favor selecciona una ficha primero en la pestaña Fichas.');
        return;
      }
      const ficha = state.fichas.find(f => f.id === selectedFichaId);
      if (ficha) {
        socket?.emit('guardar_galeria', { partidaId: state.partida.id, nombre: ficha.nombre, datos: ficha });
      }
    });

    // Daño / Curación Rápido
    dom.btnApplyDamage.addEventListener('click', () => applyHpChange(false));
    dom.btnApplyHeal.addEventListener('click', () => applyHpChange(true));

    // Cerrar Modales
    document.querySelectorAll('.btn-close-modal').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const overlay = e.target.closest('.modal-overlay');
        if (overlay) closeModal(overlay);
      });
    });
  }

  // --- LANZADOR DE DADOS CON PARSER COMPLEX ---
  function rollDice() {
    let rawFormula = dom.diceFormulaInput.value.trim().toLowerCase();
    if (!rawFormula) return;

    const classif = document.querySelector('.btn-classif.active')?.dataset.classif || 'Normal';
    const mode = document.querySelector('.btn-mode.active')?.dataset.mode || 'normal';
    const fichaId = dom.diceTokenSelect.value;
    const originalFormula = rawFormula;

    let finalResult = 0;
    let icon = '🎲';
    if (classif === 'Ataque') icon = '⚔️';
    if (classif === 'Iniciativa') icon = '🎯';
    if (classif === 'Salvación') icon = '🛡️';
    if (classif === 'Habilidad') icon = '📚';

    try {
      if (mode === 'ventaja') {
        rawFormula = rawFormula.replace(/1d20/g, '2d20kh1');
      } else if (mode === 'desventaja') {
        rawFormula = rawFormula.replace(/1d20/g, '2d20kl1');
      }

      const diceResult = evalDiceFormula(rawFormula);
      finalResult = diceResult.total;

      // Construir texto de fórmula con detalle de dados
      let formulaDisplay = originalFormula;
      if (mode !== 'normal' && diceResult.rollDetails.length > 0) {
        const modeLabel = mode === 'ventaja' ? '⭐Ventaja' : '🌑Desventaja';
        formulaDisplay = `${originalFormula} [${modeLabel}: ${diceResult.rollDetails.join(', ')}]`;
      } else if (diceResult.rollDetails.length > 0) {
        formulaDisplay = `${originalFormula} [${diceResult.rollDetails.join(', ')}]`;
      }

      socket?.emit('lanzar_dados', {
        partidaId: state.partida.id,
        usuarioId: state.usuario.id,
        nombreUsuario: state.usuario.nombre,
        formula: formulaDisplay,
        tipo: classif,
        resultado: finalResult,
        fichaId,
        icono: icon
      });

    } catch (err) {
      alert('Fórmula de dados inválida. Usa formato ej: 2d10+6+1d6 o 1d20+5');
    }
  }

  // Evaluador de Fórmulas D&D (Ej: 2d10+6+1d6-2)
  function evalDiceFormula(formula) {
    // Almacenar detalles de cada grupo de dados
    const rollDetails = [];

    // Reemplazar XdX con valor calculado aleatorio (soporte para kh/kl)
    const diceRegex = /(\d+)d(\d+)(?:k[hl](\d+))?/g;
    const evaluated = formula.replace(diceRegex, (match, count, sides, keep) => {
      let numCount = parseInt(count);
      const numSides = parseInt(sides);
      const isKh = match.includes('kh');
      const isKl = match.includes('kl');
      let numKeep = keep ? parseInt(keep) : numCount;

      let allRolls = [];
      for (let i = 0; i < numCount; i++) {
        allRolls.push(Math.floor(Math.random() * numSides) + 1);
      }

      let keptRolls = [...allRolls];
      if (isKh || isKl) {
        keptRolls.sort((a, b) => b - a); // Mayor a menor
        if (isKh) keptRolls = keptRolls.slice(0, numKeep);
        if (isKl) keptRolls = keptRolls.slice(-numKeep);
      }

      // Generar detalle visual: dados descartados tachados
      if (isKh || isKl) {
        const keptSet = new Set();
        const tempKept = [...keptRolls];
        const detail = allRolls.map(r => {
          const idx = tempKept.indexOf(r);
          if (idx !== -1) {
            tempKept.splice(idx, 1);
            return String(r);
          }
          return `~~${r}~~`; // tachado = descartado
        });
        rollDetails.push(`d${numSides}(${detail.join(', ')})`);
      } else {
        rollDetails.push(`d${numSides}(${allRolls.join(', ')})`);
      }

      return keptRolls.reduce((sum, val) => sum + val, 0);
    });

    // Validar seguridad de math expr
    if (!/^[0-9+\-*/()\s.]+$/.test(evaluated)) {
      throw new Error('Expresión no permitida');
    }

    const total = Function(`"use strict"; return (${evaluated})`)();
    return { total, rollDetails };
  }

  // --- APLICAR DAÑO / CURACIÓN ---
  function applyHpChange(esCuracion) {
    const fichaId = dom.hdTokenSelect.value;
    const cantidad = parseInt(dom.hdAmountInput.value) || 0;

    if (fichaId && cantidad > 0) {
      socket?.emit('aplicar_dano_curacion', {
        partidaId: state.partida.id,
        fichaId,
        cantidad,
        esCuracion
      });
      closeModal(dom.modalDanoCuracion);
    }
  }

  // --- CHAT Y GIFS ---
  function sendChatMessage() {
    const mensaje = dom.chatTextInput.value.trim();
    if (!mensaje) return;

    socket?.emit('enviar_mensaje', {
      partidaId: state.partida.id,
      usuarioId: state.usuario.id,
      nombreUsuario: state.usuario.nombre,
      colorUsuario: state.usuario.color,
      mensaje,
      esGif: false
    });

    dom.chatTextInput.value = '';
  }

  function renderChatMessage(msg) {
    const div = document.createElement('div');
    div.className = `chat-msg ${msg.es_dm ? 'dm-msg' : ''}`;

    const senderSpan = document.createElement('span');
    senderSpan.className = 'sender';
    senderSpan.style.color = msg.color_usuario || '#c9a84c';
    senderSpan.innerHTML = `${msg.nombre_usuario}: `;
    senderSpan.style.cursor = 'pointer';
    senderSpan.title = 'Haz clic para centrar mapa en ficha de este jugador';
    senderSpan.addEventListener('click', () => centerOnPlayerToken(msg.nombre_usuario));

    div.appendChild(senderSpan);

    if (msg.es_gif) {
      const img = document.createElement('img');
      img.src = msg.mensaje;
      img.className = 'chat-gif-img';
      img.addEventListener('click', () => {
        dom.enlargedGifImg.src = msg.mensaje;
        openModal(dom.modalGifView);
      });
      div.appendChild(img);
    } else {
      const textSpan = document.createElement('span');
      textSpan.innerHTML = msg.mensaje;
      div.appendChild(textSpan);
    }

    dom.chatMessagesContainer.appendChild(div);
  }

  function centerOnPlayerToken(username) {
    const ficha = (state.fichas || []).find(f => f.nombre.toLowerCase() === username.toLowerCase());
    if (ficha) {
      const tileSize = getTileSize();
      viewport.panX = canvas.width / 2 - (ficha.x * tileSize);
      viewport.panY = canvas.height / 2 - (ficha.y * tileSize);
      selectedFichaId = ficha.id;
      renderCanvas();
    }
  }

  function scrollChatToBottom() {
    dom.chatMessagesContainer.scrollTop = dom.chatMessagesContainer.scrollHeight;
  }

  function renderGifGrid(gifs) {
    dom.gifGrid.innerHTML = '';
    gifs.forEach(gif => {
      const img = document.createElement('img');
      img.src = gif.url;
      img.className = 'gif-item';
      img.title = gif.name;
      img.addEventListener('click', () => {
        socket?.emit('enviar_mensaje', {
          partidaId: state.partida.id,
          usuarioId: state.usuario.id,
          nombreUsuario: state.usuario.nombre,
          colorUsuario: state.usuario.color,
          mensaje: gif.url,
          esGif: true
        });
        closeModal(dom.modalGifPicker);
      });
      dom.gifGrid.appendChild(img);
    });
  }

  // --- RENDERIZADO DE LISTAS E INTERFAZ ---

  function updateUIForCurrentGame() {
    if (!state.partida) return;
    dom.navGameTitle.textContent = state.partida.nombre;
    dom.currentRoomCode.textContent = state.partida.codigo;
    dom.currentSceneName.textContent = state.escenaActiva?.nombre || 'Escena';

    if (state.usuario.esDM) {
      dom.userRoleBadge.className = 'role-badge dm';
      dom.userRoleText.textContent = 'Dungeon Master';
      document.querySelectorAll('.dm-only').forEach(el => el.classList.remove('hidden'));
    } else {
      dom.userRoleBadge.className = 'role-badge';
      dom.userRoleText.textContent = state.usuario.nombre;
      document.querySelectorAll('.dm-only').forEach(el => el.classList.add('hidden'));
    }

    dom.gridColsInput.value = state.partida.config_grid_x || 40;
    dom.gridRowsInput.value = state.partida.config_grid_y || 40;
    dom.gridFeetInput.value = state.partida.config_casilla || 5;

    renderFichasList();
    renderTokenSelects();
    renderScenesList();
    renderGalleryChips();
    renderChatMessages();
    renderHistoryTable();
    renderQuickHistory();
  }

  function renderFichasList() {
    dom.fichasList.innerHTML = '';
    const filter = dom.filterFichasInput.value.toLowerCase();

    (state.fichas || []).forEach(ficha => {
      if (filter && !ficha.nombre.toLowerCase().includes(filter)) return;

      const card = document.createElement('div');
      card.className = `ficha-card ${ficha.id === selectedFichaId ? 'selected' : ''}`;

      const isMonster = ficha.tipo === 'monstruo' || ficha.tipo === 'npc';
      const isPlayerView = !state.usuario.esDM;
      const visibility = getFichaVisibility(ficha);

      const hpText = (isMonster && isPlayerView && !visibility.hp) ? '???' : `${ficha.hp_actual}/${ficha.hp_maximo}`;
      const acText = (isMonster && isPlayerView && !visibility.ac) ? '???' : ficha.ac;
      const avatarSrc = (isMonster && isPlayerView && !visibility.imagen) ? 'https://via.placeholder.com/48?text=?' : (ficha.imagen || 'https://via.placeholder.com/48?text=Avatar');

      const esPropietario = state.usuario.esDM || 
                            ficha.jugador_id === state.usuario.id ||
                            (!ficha.jugador_id && ficha.tipo === 'jugador');

      card.innerHTML = `
        <div class="ficha-card-header">
          <img src="${avatarSrc}" class="ficha-avatar" style="cursor: pointer;" title="Haz clic para ampliar">
          <div class="ficha-info">
            <div class="ficha-name">${(isMonster && isPlayerView && !visibility.nombre) ? '???' : ficha.nombre}</div>
            <div class="ficha-sub">${ficha.tipo.toUpperCase()} | HP: ${hpText} | AC: ${acText}</div>
            <div class="hp-bar-outer">
              <div class="hp-bar-inner" style="width: ${Math.max(0, Math.min(100, (ficha.hp_actual / (ficha.hp_maximo || 1)) * 100))}%"></div>
            </div>
          </div>
        </div>
        <div class="ficha-actions">
          ${esPropietario ? '<button class="btn btn-sm btn-secondary btn-gigante"><i class="fa-solid fa-up-right-and-down-left-from-center"></i> Gigante</button>' : ''}
          ${state.usuario.esDM && isMonster ? `<button class="btn btn-sm btn-primary btn-revelar-menu"><i class="fa-solid fa-eye"></i> Visibilidad</button>` : ''}
          ${esPropietario ? '<button class="btn btn-sm btn-primary btn-edit-ficha"><i class="fa-solid fa-pen"></i> Editar</button>' : ''}
          ${state.usuario.esDM ? '<button class="btn btn-sm btn-danger btn-del-ficha"><i class="fa-solid fa-trash"></i></button>' : ''}
        </div>
      `;

      const avatarImg = card.querySelector('.ficha-avatar');
      if (avatarImg) {
        avatarImg.addEventListener('click', () => {
          dom.enlargedGifImg.src = ficha.imagen || 'https://via.placeholder.com/200?text=Avatar';
          if (dom.enlargedImgTitle) dom.enlargedImgTitle.textContent = ficha.nombre;
          openModal(dom.modalGifView);
        });
      }

      if (esPropietario) {
        card.querySelector('.btn-gigante')?.addEventListener('click', () => {
          socket?.emit('toggle_gigante', { partidaId: state.partida.id, fichaId: ficha.id });
        });

        card.querySelector('.btn-edit-ficha')?.addEventListener('click', () => {
          document.getElementById('ficha-id').value = ficha.id;
          document.getElementById('ficha-nombre').value = ficha.nombre;
          document.getElementById('ficha-tipo').value = ficha.tipo;
          dom.fichaImgPreview.src = ficha.imagen || 'https://via.placeholder.com/100?text=Avatar';
          document.getElementById('ficha-fue').value = ficha.fuerza || 10;
          document.getElementById('ficha-des').value = ficha.destreza || 10;
          document.getElementById('ficha-con').value = ficha.constitucion || 10;
          document.getElementById('ficha-int').value = ficha.inteligencia || 10;
          document.getElementById('ficha-sab').value = ficha.sabiduria || 10;
          document.getElementById('ficha-car').value = ficha.carisma || 10;
          document.getElementById('ficha-hp-act').value = ficha.hp_actual;
          document.getElementById('ficha-hp-max').value = ficha.hp_maximo;
          document.getElementById('ficha-ac').value = ficha.ac;
          document.getElementById('ficha-vel').value = ficha.velocidad || 30;
          document.getElementById('ficha-ini').value = ficha.iniciativa || 0;
          document.getElementById('ficha-nivel').value = ficha.nivel || 1;
          document.getElementById('ficha-altura').value = ficha.altura || 2;
          document.getElementById('ficha-tamanio').value = ficha.tamanio_base || 'mediano';
          document.getElementById('ficha-notas').value = ficha.notas || '';

          dom.modalFichaTitle.textContent = 'Editar Ficha: ' + ficha.nombre;

          const fichaTipo = document.getElementById('ficha-tipo');
          Array.from(fichaTipo.options).forEach(opt => {
            if (!state.usuario.esDM && opt.value !== 'jugador') {
              opt.style.display = 'none';
            } else {
              opt.style.display = '';
            }
          });

          openModal(dom.modalFicha);
        });
      }

      if (state.usuario.esDM && isMonster) {
        card.querySelector('.btn-revelar-menu')?.addEventListener('click', () => {
          abrirMenuRevelado(ficha);
        });
      }

      if (state.usuario.esDM) {
        card.querySelector('.btn-del-ficha')?.addEventListener('click', () => {
          if (confirm(`¿Eliminar la ficha de ${ficha.nombre}?`)) {
            socket?.emit('eliminar_ficha', { partidaId: state.partida.id, fichaId: ficha.id });
          }
        });
      }

      dom.fichasList.appendChild(card);
    });
  }

  function renderTokenSelects() {
    dom.diceTokenSelect.innerHTML = '<option value="">-- Sin ficha (Jugador) --</option>';
    dom.hdTokenSelect.innerHTML = '';

    (state.fichas || []).forEach(f => {
      const esPropia = state.usuario.esDM || 
                       f.jugador_id === state.usuario.id ||
                       (!f.jugador_id && f.tipo === 'jugador');

      if (esPropia) {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = f.nombre;
        dom.diceTokenSelect.appendChild(opt.cloneNode(true));
        dom.hdTokenSelect.appendChild(opt);
      }
    });
  }

  function renderScenesList() {
    dom.scenesList.innerHTML = '';
    (state.escenas || []).forEach(sc => {
      const item = document.createElement('div');
      item.className = `scene-item ${sc.id === state.escenaActiva?.id ? 'active' : ''}`;
      item.innerHTML = `
        <span>🎬 ${sc.nombre}</span>
        <div class="actions">
          <button class="btn btn-sm btn-primary btn-load-scene">Activar</button>
          <button class="btn btn-sm btn-danger btn-del-scene"><i class="fa-solid fa-trash"></i></button>
        </div>
      `;

      item.querySelector('.btn-load-scene').addEventListener('click', () => {
        socket?.emit('cambiar_escena', { partidaId: state.partida.id, escenaId: sc.id });
      });

      item.querySelector('.btn-del-scene').addEventListener('click', () => {
        if (confirm(`¿Eliminar la escena ${sc.nombre}?`)) {
          socket?.emit('eliminar_escena', { partidaId: state.partida.id, escenaId: sc.id });
        }
      });

      dom.scenesList.appendChild(item);
    });
  }

  function renderGalleryChips() {
    dom.dmGalleryList.innerHTML = '';
    (state.galeria || []).forEach(g => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.innerHTML = `🐲 ${g.nombre} <i class="fa-solid fa-xmark btn-del-gal"></i>`;

      chip.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-del-gal')) {
          socket?.emit('eliminar_galeria', { partidaId: state.partida.id, galeriaId: g.id });
        } else {
          // Instanciar nueva ficha desde plantilla
          const datosFicha = JSON.parse(g.datos);
          datosFicha.x = 5;
          datosFicha.y = 5;
          socket?.emit('crear_ficha', { partidaId: state.partida.id, escenaId: state.escenaActiva.id, fichaData: datosFicha });
        }
      });

      dom.dmGalleryList.appendChild(chip);
    });
  }

  function renderChatMessages() {
    dom.chatMessagesContainer.innerHTML = '';
    (state.mensajes || []).forEach(renderChatMessage);
    scrollChatToBottom();
  }

  function renderHistoryTable() {
    dom.historyTableBody.innerHTML = '';
    const q = dom.searchHistoryInput.value.toLowerCase();
    const filtered = (state.historial || []).filter(h => h.nombre_usuario.toLowerCase().includes(q));

    const startIdx = (historyPage - 1) * historyPerPage;
    const pageItems = filtered.slice(startIdx, startIdx + historyPerPage);

    pageItems.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="color:${item.color_usuario || '#c9a84c'}; font-weight:bold;">${item.nombre_usuario}</td>
        <td><code>${item.formula}</code></td>
        <td>${item.tipo}</td>
        <td style="font-weight:bold; color:#f0d060;">${item.resultado}</td>
        <td style="font-size:0.75rem; color:#94a3b8;">${new Date(item.fecha).toLocaleTimeString()}</td>
      `;
      dom.historyTableBody.appendChild(tr);
    });

    const totalPages = Math.ceil(filtered.length / historyPerPage) || 1;
    dom.histPageInfo.textContent = `Página ${historyPage} de ${totalPages}`;
  }

  function renderQuickHistory() {
    dom.quickDiceHistory.innerHTML = '';
    const last5 = (state.historial || []).slice(0, 5);
    last5.forEach(h => {
      const div = document.createElement('div');
      div.innerHTML = `<strong>${h.nombre_usuario}</strong>: ${h.formula} = <strong class="gold-text">${h.resultado}</strong> (${h.tipo})`;
      dom.quickDiceHistory.appendChild(div);
    });
  }

  // --- GESTIÓN DE PARTIDAS GUARDADAS EN PANTALLA INICIO ---
  async function loadGamesList() {
    try {
      const res = await fetch('/api/partidas');
      if (!res.ok) throw new Error('Respuesta no OK');
      const partidas = await res.json();

      dom.gamesList.innerHTML = '';

      if (partidas.length === 0) {
        dom.gamesList.innerHTML = '<div class="empty-state">No hay partidas guardadas. ¡Crea una nueva partida arriba!</div>';
        return;
      }

      partidas.forEach(p => {
        const card = document.createElement('div');
        card.className = 'game-card';
        card.innerHTML = `
          <div class="card-title">${p.nombre}</div>
          <div class="card-meta">
            <span>Code: <strong>${p.codigo}</strong></span>
            <span>Jugadores: ${p.total_jugadores || 1}</span>
          </div>
          <div class="card-meta">
            <span>Editado: ${new Date(p.fecha_modificacion).toLocaleDateString()}</span>
          </div>
          <div class="card-actions">
            <button class="btn btn-primary btn-sm btn-load-game flex-1">Cargar Partida</button>
            <button class="btn btn-danger btn-sm btn-del-game"><i class="fa-solid fa-trash"></i></button>
          </div>
        `;

        card.querySelector('.btn-load-game').addEventListener('click', () => {
          const usrId = 'usr_' + Math.random().toString(36).substr(2, 9);
          socket?.emit('unirse_partida', { codigo: p.codigo, nombreUsuario: 'Jugador', usuarioId: usrId, esDMRequested: false });
        });

        card.querySelector('.btn-del-game').addEventListener('click', async () => {
          if (confirm(`¿Eliminar definitivamente la partida "${p.nombre}"?`)) {
            await fetch(`/api/partidas/${p.id}`, { method: 'DELETE' });
            loadGamesList();
          }
        });

        dom.gamesList.appendChild(card);
      });

    } catch (err) {
      console.warn('Servidor no disponible o modo offline');
      dom.gamesList.innerHTML = '<div class="empty-state">Conéctate al servidor ejecutando `npm start` para cargar partidas.</div>';
    }
  }

  function autoSaveGame() {
    if (state.partida?.id) {
      socket?.emit('guardado_automatico', { partidaId: state.partida.id });
    }
  }

  function setupAutoSave() {
    setInterval(autoSaveGame, 10000);
  }

  function showSaveIndicator(text) {
    if (dom.saveStatusIndicator) {
      dom.saveStatusIndicator.querySelector('span').textContent = text;
      dom.saveStatusIndicator.classList.add('saving');
      setTimeout(() => dom.saveStatusIndicator.classList.remove('saving'), 2000);
    }
  }

  // MODALES & PANTALLAS
  function openModal(modal) {
    if (modal) modal.classList.remove('hidden');
  }

  let currentFichaReveladoConfig = null;

  function abrirMenuRevelado(ficha) {
    dom.revelarFichaId.value = ficha.id;
    
    // Parsear config actual
    let config;
    try {
      config = JSON.parse(ficha.revelado);
    } catch(e) {
      const isRevealed = ficha.revelado === 1 || ficha.revelado === '1' || ficha.revelado === true;
      config = { global: { imagen: isRevealed, nombre: isRevealed, hp: isRevealed, ac: isRevealed, notas: isRevealed }, jugadores: {} };
    }
    if (!config || !config.global) {
      config = { global: { imagen: false, nombre: false, hp: false, ac: false, notas: false }, jugadores: {} };
    }
    
    currentFichaReveladoConfig = config;

    // Llenar select de jugadores
    dom.revJugadoresSelect.innerHTML = '<option value="todos">Todos los Jugadores (Global)</option>';
    if (state.partida?.jugadores) {
      state.partida.jugadores.forEach(j => {
        if (!j.esDM) {
          const opt = document.createElement('option');
          opt.value = j.id;
          opt.textContent = j.nombre;
          dom.revJugadoresSelect.appendChild(opt);
        }
      });
    }

    dom.revJugadoresSelect.value = 'todos';
    cargarCheckboxesRevelado('todos');
    
    dom.revJugadoresSelect.onchange = () => {
      cargarCheckboxesRevelado(dom.revJugadoresSelect.value);
    };

    openModal(dom.modalRevelar);
  }

  function cargarCheckboxesRevelado(jugadorId) {
    const config = currentFichaReveladoConfig;
    let target = (jugadorId === 'todos') ? config.global : (config.jugadores[jugadorId] || config.global);

    dom.revImagen.checked = !!target.imagen;
    dom.revNombre.checked = !!target.nombre;
    dom.revHp.checked = !!target.hp;
    dom.revAc.checked = !!target.ac;
    dom.revNotas.checked = !!target.notas;
  }

  dom.btnAplicarRevelado?.addEventListener('click', () => {
    const fichaId = dom.revelarFichaId.value;
    const targetJugador = dom.revJugadoresSelect.value;
    
    if (!currentFichaReveladoConfig.jugadores) currentFichaReveladoConfig.jugadores = {};

    const newConf = {
      imagen: dom.revImagen.checked,
      nombre: dom.revNombre.checked,
      hp: dom.revHp.checked,
      ac: dom.revAc.checked,
      notas: dom.revNotas.checked
    };

    if (targetJugador === 'todos') {
      currentFichaReveladoConfig.global = newConf;
      // Actualizar a los jugadores que no tienen overrides
      // O podríamos simplemente limpiar los overrides si se pone global (opcional). 
      // Por ahora mantenemos los overrides que ya tengan.
    } else {
      currentFichaReveladoConfig.jugadores[targetJugador] = newConf;
    }

    socket.emit('actualizar_config_revelado', {
      partidaId: state.partida.id,
      fichaId: fichaId,
      config: currentFichaReveladoConfig
    });

    closeModal(dom.modalRevelar);
  });

  function closeModal(modal) {
    if (modal) modal.classList.add('hidden');
  }

  function showScreen(name) {
    if (name === 'start') {
      dom.screenStart.classList.remove('hidden');
      dom.screenVTT.classList.add('hidden');
    } else {
      dom.screenStart.classList.add('hidden');
      dom.screenVTT.classList.remove('hidden');
      resizeCanvas();
    }
  }

})();
