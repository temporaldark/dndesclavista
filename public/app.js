/* ==========================================================================
   VTT D&D 5e - CLIENT CORE ENGINE (app.js)
   Manejo de Canvas, Drag & Drop (Mouse + Touch), Sockets, Dados, Chat y DM Tools
   ========================================================================== */

(function () {
  'use strict';

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
    jugadoresConectados: [],
    usuario: { id: null, nombre: '', esDM: false, color: '#c9a84c' }
  };

  // Helper para eliminar cualquier variante o repetición de '(Restaurada)'
  function limpiarNombrePartida(nombre) {
    if (!nombre) return 'Partida';
    let limpio = String(nombre);
    while (/[\(\[\{\-_]?(?:restaurada|restaurado|copia|backup)[\)\]\}]?/i.test(limpio)) {
      limpio = limpio.replace(/\s*[\(\[\{\-_]?(?:restaurada|restaurado|copia|backup)[\)\]\}]?/gi, '');
    }
    return limpio.replace(/[\s\-_]+$/g, '').trim() || 'Partida';
  }

  // Clasificación activa para filtrar targets
  let currentClassif = 'Normal';

  // Resultado pendiente de dado para modal post-lanzamiento
  let pendingDiceResult = null;

  let showHpBars = false;
  let sortInitiative = true;

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
  let selectedFichasIds = [];
  let isMultiSelectMode = false;
  let isDraggingToken = false;
  let dragOffsets = {};
  let isDraggingFigure = false;
  let selectedFigureId = null;
  let dragOffset = { x: 0, y: 0 }; // Para arrastrar figuras individuales

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

  // RAF render flag
  let isDirty = false;
  let rafScheduled = false;

  // Paginación Historial
  let historyPage = 1;
  const historyPerPage = 10;

  // Helper para parsear números preservando 0
  function parseNumberSafe(val, fallback = 0) {
    if (val === '' || val === null || val === undefined) return fallback;
    const n = parseInt(val, 10);
    return isNaN(n) ? fallback : n;
  }

  // --- INICIALIZACIÓN ---
  window.addEventListener('DOMContentLoaded', () => {
    // Generar o cargar usuario id local basado en nombre de usuario si existe
    let savedUsername = localStorage.getItem('vtt_username');
    let savedUserId = localStorage.getItem('vtt_user_id');
    if (savedUsername) {
      savedUserId = 'usr_' + savedUsername.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
      localStorage.setItem('vtt_user_id', savedUserId);
    } else if (!savedUserId) {
      savedUserId = 'usr_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('vtt_user_id', savedUserId);
    }
    state.usuario.id = savedUserId;
    if (savedUsername) state.usuario.nombre = savedUsername;

    initDOM();
    initCanvas();
    initSocket();
    loadGamesList();
    setupAutoSave();

    // Auto-reanudar sesión si se actualizó la página (F5) o se reinició el navegador
    const activeCode = localStorage.getItem('vtt_active_game_code');
    if (activeCode && state.usuario.nombre) {
      console.log('🔄 Reanudando automáticamente sesión activa tras recarga/actualización:', activeCode);
      showScreen('vtt');
      showSaveIndicator('🔄 Reanudando...');
      if (dom.currentRoomCode) dom.currentRoomCode.textContent = activeCode;
      window._emitWhenReady('unirse_partida', {
        codigo: activeCode,
        nombreUsuario: state.usuario.nombre,
        usuarioId: state.usuario.id
      });
    }
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
      btnMobileDmTools: document.getElementById('btn-mobile-dm-tools'),
      mobileOverlay: document.getElementById('mobile-overlay'),
      rightPanel: document.getElementById('right-panel'),
      dmToolsPanel: document.getElementById('dm-tools-panel'),

      // Lista Partidas
      gamesList: document.getElementById('games-list'),
      btnCreateGameModal: document.getElementById('btn-create-game-modal'),
      btnJoinGameModal: document.getElementById('btn-join-game-modal'),
      btnImportGame: document.getElementById('btn-import-game'),
      inputImportGameFile: document.getElementById('input-import-game-file'),
      btnDmExportSession: document.getElementById('btn-dm-export-session'),
      btnDmImportSession: document.getElementById('btn-dm-import-session'),
      inputDmImportFile: document.getElementById('input-dm-import-file'),
      reconnectBanner: document.getElementById('reconnect-banner'),
      reconnectMsg: document.getElementById('reconnect-msg'),
      btnReconnectNow: document.getElementById('btn-reconnect-now'),
      btnEmergencyExport: document.getElementById('btn-emergency-export'),
      btnDmSaveNow: document.getElementById('btn-dm-save-now'),
      btnRefreshBackups: document.getElementById('btn-refresh-backups'),
      dmBackupsList: document.getElementById('dm-backups-list'),
      toastContainer: document.getElementById('toast-container'),

      // Canvas
      canvasWrapper: document.getElementById('canvas-wrapper'),
      canvasContainer: document.getElementById('vtt-canvas-container'),
      canvas: document.getElementById('vtt-canvas'),
      mapBgImg: document.getElementById('vtt-map-bg'),
      btnMultiSelectMode: document.getElementById('btn-multi-select-mode'),
      multiSelectCount: document.getElementById('multi-select-count'),
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
      figRotation: document.getElementById('fig-rotation'),
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
      d20ModeContainer: document.getElementById('d20-mode-container'),
      modeButtons: document.querySelectorAll('.btn-mode'),
      diceTokenSelect: document.getElementById('dice-token-select'),
      quickDiceHistory: document.getElementById('quick-dice-history'),

      // Chat
      chatMessagesContainer: document.getElementById('chat-messages-container'),
      chatTextInput: document.getElementById('chat-text-input'),
      btnUploadChatMedia: document.getElementById('btn-upload-chat-media'),
      chatFileInput: document.getElementById('chat-file-input'),
      btnSendChat: document.getElementById('btn-send-chat'),

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
      dmPlayersList: document.getElementById('dm-players-list'),
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

      modalGifView: document.getElementById('modal-gif-view'),
      enlargedGifImg: document.getElementById('enlarged-gif-img'),
      enlargedImgTitle: document.getElementById('enlarged-img-title'),
      enlargedImgNotas: document.getElementById('enlarged-img-notas'),

      modalRevelar: document.getElementById('modal-revelar-ficha'),
      revelarFichaId: document.getElementById('revelar-ficha-id'),
      revImagen: document.getElementById('rev-imagen'),
      revNombre: document.getElementById('rev-nombre'),
      revHp: document.getElementById('rev-hp'),
      revAc: document.getElementById('rev-ac'),
      revNotas: document.getElementById('rev-notas'),
      revJugadoresSelect: document.getElementById('rev-jugadores-select'),
      btnSaveRevelar: document.getElementById('btn-save-revelar') || document.getElementById('btn-aplicar-revelado'),

      modalCreateGame: document.getElementById('modal-create-game'),
      formCreateGame: document.getElementById('form-create-game'),
      createGameTitle: document.getElementById('create-game-title') || document.getElementById('new-game-name'),
      createDmName: document.getElementById('create-dm-name'),
      createGameImgFile: document.getElementById('create-game-img-file'),
      createGameImgUrl: document.getElementById('create-game-img-url') || document.getElementById('new-game-image'),

      modalJoinGame: document.getElementById('modal-join-game'),
      formJoinGame: document.getElementById('form-join-game'),
      joinCodeInput: document.getElementById('join-code-input'),
      joinUsernameInput: document.getElementById('join-username-input'),
      codeBadge: document.getElementById('code-badge')
    };

    setupEventListeners();
    setupMobileMenuListeners();
  }

  function setupMobileMenuListeners() {
    function closeAllPanels() {
      dom.rightPanel.classList.remove('open');
      dom.dmToolsPanel.classList.remove('open');
      dom.mobileOverlay.classList.remove('active');
    }

    if (dom.btnMobileMenu) {
      dom.btnMobileMenu.addEventListener('click', () => {
        const isOpen = dom.rightPanel.classList.contains('open');
        closeAllPanels();
        if (!isOpen) {
          dom.rightPanel.classList.add('open');
          dom.mobileOverlay.classList.add('active');
        }
      });
    }

    if (dom.btnMobileDmTools) {
      dom.btnMobileDmTools.addEventListener('click', () => {
        const isOpen = dom.dmToolsPanel.classList.contains('open');
        closeAllPanels();
        if (!isOpen) {
          dom.dmToolsPanel.classList.add('open');
          dom.mobileOverlay.classList.add('active');
        }
      });
    }

    if (dom.mobileOverlay) {
      dom.mobileOverlay.addEventListener('click', closeAllPanels);
    }
  }

  function esDuenioDeFicha(ficha) {
    if (!ficha) return false;
    if (state.usuario.esDM) return true;

    const uId = (state.usuario.id || '').toLowerCase().trim();
    const uName = (state.usuario.nombre || '').toLowerCase().trim();
    const fJugadorId = (ficha.jugador_id || '').toLowerCase().trim();

    if (fJugadorId && (fJugadorId === uId || fJugadorId === uName || fJugadorId === 'usr_' + uName.replace(/[^a-z0-9]/g, '_'))) return true;
    if (ficha.tipo === 'jugador' && (!ficha.jugador_id || ficha.jugador_id === '')) return true;

    return false;
  }

  function getFichaVisibility(ficha) {
    if (state.usuario.esDM || ficha.tipo === 'jugador') {
      return { imagen: true, nombre: true, hp: true, ac: true, notas: true };
    }

    let config;
    try {
      config = JSON.parse(ficha.revelado);
    } catch (e) {
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

    socket = io({
      transports: ['websocket', 'polling'], // Priorizar WebSocket directo para conexión ultrarrápida
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000
    });

    // Helper: emite cuando el socket esté conectado
    window._emitWhenReady = function(event, data) {
      if (!socket) { initSocket(); }
      if (socket.connected) {
        socket.emit(event, data);
      } else {
        socket.once('connect', () => socket.emit(event, data));
      }
    };

    // Reconexión y Estado de Conexión
    socket.on('connect', () => {
      if (dom.reconnectBanner) dom.reconnectBanner.classList.add('hidden');
      showSaveIndicator('🟢 Conectado');

      const activeCode = state.partida?.codigo || localStorage.getItem('vtt_active_game_code');
      if (activeCode && state.usuario.nombre) {
        socket.emit('unirse_partida', {
          codigo: activeCode,
          nombreUsuario: state.usuario.nombre,
          usuarioId: state.usuario.id
        });
      }
    });

    socket.on('disconnect', (reason) => {
      console.warn('⚠️ Desconectado del host:', reason);
      if (dom.reconnectBanner) {
        dom.reconnectBanner.classList.remove('hidden');
        if (dom.reconnectMsg) {
          dom.reconnectMsg.textContent = 'Conexión interrumpida (' + reason + '). Reconectando automáticamente...';
        }
      }
      showSaveIndicator('🔴 Desconectado');
    });

    socket.on('connect_error', () => {
      if (dom.reconnectBanner) {
        dom.reconnectBanner.classList.remove('hidden');
        if (dom.reconnectMsg) {
          dom.reconnectMsg.textContent = 'Problema de red o servidor no disponible. Reintentando...';
        }
      }
      showSaveIndicator('🔴 Reconectando...');
    });

    socket.on('partida_restaurada', ({ mensaje }) => {
      showToast('🔄 ' + (mensaje || 'Partida cargada a una versión previa.'), 'info');
      if (state.partida?.codigo) {
        socket.emit('unirse_partida', {
          codigo: state.partida.codigo,
          nombreUsuario: state.usuario.nombre,
          usuarioId: state.usuario.id
        });
      }
    });

    socket.on('estado_inicial', (data) => {
      if (data.partida) {
        data.partida.nombre = limpiarNombrePartida(data.partida.nombre);
      }
      state.partida = data.partida;
      state.escenaActiva = data.escenaActiva;
      state.escenas = data.escenas || [];
      state.fichas = data.fichas || [];
      state.figuras = data.figuras || [];
      state.dibujos = data.dibujos || [];
      state.mensajes = data.mensajes || [];
      state.historial = data.historial || [];
      state.galeria = data.galeria || [];
      state.jugadoresConectados = data.jugadoresConectados || [];
      state.usuario = data.usuario;

      // Guardar partida activa en almacenamiento local para no perder contexto ante F5 o recargas
      if (state.partida && state.partida.codigo) {
        localStorage.setItem('vtt_active_game_code', state.partida.codigo);
        localStorage.setItem('vtt_active_game_id', state.partida.id);
      }
      saveLocalMirrorBackup();
      if (state.usuario.esDM) {
        loadDmBackupsList();
      }

      updateUIForCurrentGame();
      showScreen('vtt');
      if (state.escenaActiva && state.escenaActiva.mapa) {
        loadMapImage(state.escenaActiva.mapa);
      } else {
        markDirty();
      }
    });

    socket.on('error_partida', (msg) => {
      alert('❌ Error: ' + msg);
    });

    socket.on('escena_cambiada', ({ escenaActiva, figuras, dibujos, posiciones_fichas }) => {
      state.escenaActiva = escenaActiva;
      state.figuras = figuras || [];
      state.dibujos = dibujos || [];
      if (dom.currentSceneName) dom.currentSceneName.textContent = escenaActiva.nombre;
      if (dom.gridColsInput) dom.gridColsInput.value = escenaActiva.config_grid_x || 40;
      if (dom.gridRowsInput) dom.gridRowsInput.value = escenaActiva.config_grid_y || 40;
      if (dom.gridFeetInput) dom.gridFeetInput.value = escenaActiva.config_casilla || 5;
      
      const posMap = new Map((posiciones_fichas || []).map(p => [p.ficha_id, p]));
      state.fichas.forEach(f => {
        const pos = posMap.get(f.id);
        if (pos) {
          f.x = pos.x;
          f.y = pos.y;
        }
      });

      loadMapImage(escenaActiva.mapa);
      renderFichasList();
      renderTokenSelects();
      renderScenesList();
      markDirty();
    });

    socket.on('escenas_actualizadas', (escenas) => {
      state.escenas = escenas || [];
      renderScenesList();
    });

    socket.on('mapa_actualizado', ({ escenaId, mapa }) => {
      if (state.escenaActiva && state.escenaActiva.id === escenaId) {
        state.escenaActiva.mapa = mapa;
        loadMapImage(mapa);
        markDirty();
      }
    });

    socket.on('grid_actualizado', ({ escenaId, gridX, gridY, casilla }) => {
      if (state.partida) {
        state.partida.config_grid_x = gridX;
        state.partida.config_grid_y = gridY;
        state.partida.config_casilla = casilla;
      }
      const esc = state.escenas.find(e => e.id === escenaId);
      if (esc) {
        esc.config_grid_x = gridX;
        esc.config_grid_y = gridY;
        esc.config_casilla = casilla;
      }
      if (state.escenaActiva && state.escenaActiva.id === escenaId) {
        state.escenaActiva.config_grid_x = gridX;
        state.escenaActiva.config_grid_y = gridY;
        state.escenaActiva.config_casilla = casilla;
        if (dom.gridColsInput) dom.gridColsInput.value = gridX;
        if (dom.gridRowsInput) dom.gridRowsInput.value = gridY;
        if (dom.gridFeetInput) dom.gridFeetInput.value = casilla;
        markDirty();
      }
    });

    socket.on('ficha_movida', ({ fichaId, x, y }) => {
      const ficha = state.fichas.find(f => f.id === fichaId);
      if (ficha) {
        ficha.x = x;
        ficha.y = y;
        markDirty();
        debounceLocalMirrorSave();
      }
    });

    socket.on('ficha_creada', (nuevaFicha) => {
      state.fichas.push(nuevaFicha);
      renderFichasList();
      renderTokenSelects();
      markDirty();
      debounceLocalMirrorSave();
    });

    socket.on('ficha_actualizada', (fichaActualizada) => {
      const idx = state.fichas.findIndex(f => f.id === fichaActualizada.id);
      if (idx !== -1) {
        state.fichas[idx] = fichaActualizada;
        renderFichasList();
        renderTokenSelects();
        markDirty();
        debounceLocalMirrorSave();
      }
    });

    socket.on('gigante_toggled', ({ fichaId, gigante }) => {
      const ficha = state.fichas.find(f => f.id === fichaId);
      if (ficha) {
        ficha.gigante = !!gigante;
        markDirty();
        renderFichasList();
        debounceLocalMirrorSave();
      }
    });

    socket.on('revelado_toggled', ({ fichaId, revelado }) => {
      const ficha = state.fichas.find(f => f.id === fichaId);
      if (ficha) {
        ficha.revelado = revelado;
        markDirty();
        renderFichasList();
        debounceLocalMirrorSave();
      }
    });

    socket.on('ficha_eliminada', (fichaId) => {
      state.fichas = state.fichas.filter(f => f.id !== fichaId);
      renderFichasList();
      renderTokenSelects();
      markDirty();
      debounceLocalMirrorSave();
    });

    socket.on('hp_actualizado', ({ fichaId, hp_actual }) => {
      const ficha = state.fichas.find(f => f.id === fichaId);
      if (ficha) {
        ficha.hp_actual = hp_actual;
        renderFichasList();
        markDirty();
        debounceLocalMirrorSave();
      }
    });

    socket.on('figuras_actualizadas', (figuras) => {
      state.figuras = figuras || [];
      markDirty();
      debounceLocalMirrorSave();
    });

    socket.on('update_dm_status', ({ esDM }) => {
      state.usuario.esDM = esDM;
      updateUIForCurrentGame();
    });

    // Lista de jugadores conectados (para menú de visibilidad)
    socket.on('lista_jugadores', (jugadores) => {
      state.jugadoresConectados = jugadores || [];
      renderDmPlayersList();
    });

    socket.on('dibujos_actualizadas', (dibujos) => {
      state.dibujos = dibujos || [];
      markDirty();
      debounceLocalMirrorSave();
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

    socket.on('guardado_confirmado', (data) => {
      showSaveIndicator('✅ Guardado');
      saveLocalMirrorBackup();
      if (data && data.snapshot) {
        showToast('💾 Copia de seguridad guardada con éxito en el servidor y localmente.', 'success');
        if (state.usuario.esDM) loadDmBackupsList();
      }
    });

    socket.on('oculto_toggled', ({ fichaId, oculto }) => {
      const f = (state.fichas || []).find(x => x.id === fichaId);
      if (f) {
        f.oculto = oculto;
        renderFichasList();
        markDirty();
      }
    });
  }

  // --- CANVAS & VTT ENGINE ---
  function markDirty() {
    isDirty = true;
    if (!rafScheduled) {
      rafScheduled = true;
      requestAnimationFrame(rafRender);
    }
  }

  function rafRender() {
    rafScheduled = false;
    if (isDirty) {
      isDirty = false;
      renderCanvas();
    }
  }

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
    markDirty();
  }

  // Centra el viewport en el centro del mapa
  function centerMap() {
    if (!canvas) return;
    const cols = state.escenaActiva?.config_grid_x || state.partida?.config_grid_x || 40;
    const rows = state.escenaActiva?.config_grid_y || state.partida?.config_grid_y || 40;
    const mapWidth = cols * viewport.tileSize;
    const mapHeight = rows * viewport.tileSize;
    viewport.panX = (canvas.width - mapWidth * viewport.zoom) / 2;
    viewport.panY = (canvas.height - mapHeight * viewport.zoom) / 2;
  }

  function loadMapImage(src) {
    if (!src) {
      mapImageLoaded = false;
      mapImage = new Image();
      if (dom.mapBgImg) {
        dom.mapBgImg.src = '';
        dom.mapBgImg.classList.add('hidden');
      }
      markDirty();
      return;
    }
    const img = new Image();
    img.onload = () => {
      mapImage = img;
      
      if (src.startsWith('data:image/gif')) {
        dom.mapBgImg.src = src;
        dom.mapBgImg.classList.remove('hidden');
        mapImage = null; // Don't render with canvas if it's a GIF
      } else {
        if (dom.mapBgImg) {
          dom.mapBgImg.classList.add('hidden');
          dom.mapBgImg.src = '';
        }
      }
      
      if (!isPanning) centerMap(); // Centrar al cargar mapa
      markDirty();
    };
    img.src = src;
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

    const cols = state.escenaActiva?.config_grid_x || state.partida?.config_grid_x || 40;
    const rows = state.escenaActiva?.config_grid_y || state.partida?.config_grid_y || 40;
    const tileSize = viewport.tileSize; // Se usa base para no escalar 2 veces

    ctx.save();
    ctx.translate(viewport.panX, viewport.panY);
    ctx.scale(viewport.zoom, viewport.zoom);

    // Sincronizar el img (GIF) si está activo
    if (dom.mapBgImg && !dom.mapBgImg.classList.contains('hidden')) {
      dom.mapBgImg.style.transform = `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`;
      dom.mapBgImg.style.width = (cols * tileSize) + 'px';
      dom.mapBgImg.style.height = (rows * tileSize) + 'px';
    }

    const mapWidth = cols * tileSize;
    const mapHeight = rows * tileSize;

    // 1. Dibujar Mapa de Fondo (si existe y no es GIF)
    if (mapImage) {
      ctx.drawImage(mapImage, 0, 0, mapWidth, mapHeight);
    } else {
      // Fondo oscuro por defecto
      ctx.fillStyle = '#0d0d22';
      ctx.fillRect(0, 0, mapWidth, mapHeight);
    }

    // 2. Dibujar Grid de Casillas (Batch unificado en 1 solo path para máximo rendimiento)
    ctx.strokeStyle = 'rgba(201, 168, 76, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= cols; c++) {
      const cx = c * tileSize;
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, mapHeight);
    }
    for (let r = 0; r <= rows; r++) {
      const ry = r * tileSize;
      ctx.moveTo(0, ry);
      ctx.lineTo(mapWidth, ry);
    }
    ctx.stroke();

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

        ctx.translate(centerX, centerY);
        if (fig.rotacion) {
          ctx.rotate(fig.rotacion * Math.PI / 180);
        }

        if (fig.tipo === 'circulo') {
          ctx.beginPath();
          ctx.arc(0, 0, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (fig.tipo === 'cuadrado') {
          ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
          ctx.strokeRect(-radius, -radius, radius * 2, radius * 2);
        } else if (fig.tipo === 'rectangulo') {
          ctx.fillRect(-radius, -radius * 2, radius * 2, radius * 4);
          ctx.strokeRect(-radius, -radius * 2, radius * 2, radius * 4);
        } else if (fig.tipo === 'cono') {
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, radius, -Math.PI / 4, Math.PI / 4);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }

        // Deshacer rotación para la etiqueta, si no quieres que el texto rote.
        // Pero si la rotación se deshace, hay que recordar que ya estamos en centerX, centerY.
        ctx.restore();
        ctx.save();


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
    const fichasEnEscena = (state.fichas || []).filter(f => f.tipo === 'jugador' || f.escena_id === state.escenaActiva?.id);
    fichasEnEscena.forEach(ficha => {
      // Si la ficha está oculta por el DM: jugadores no la ven en absoluto, DM la ve translúcida
      if (ficha.oculto) {
        if (!state.usuario.esDM && !esDuenioDeFicha(ficha)) {
          return;
        }
      }

      const isMonster = ficha.tipo === 'monstruo' || ficha.tipo === 'npc';
      const isPlayerView = !state.usuario.esDM;
      const visibility = getFichaVisibility(ficha);

      // Calcular multiplicador de tamaño (Gigante = x2)
      let scaleMult = 1;
      if (ficha.tamanio_base === 'grande') scaleMult = 2;
      if (ficha.tamanio_base === 'enorme') scaleMult = 3;
      if (ficha.tamanio_base === 'gargantua') scaleMult = 4;
      if (ficha.tamanio_base === 'enano') scaleMult = 0.75;
      if (ficha.gigante) scaleMult *= 2;

      const tokenWidth = tileSize * scaleMult;
      const tokenHeight = tileSize * scaleMult;
      const px = ficha.x * tileSize;
      const py = ficha.y * tileSize;

      ctx.save();

      if (ficha.hp_actual <= 0) {
        ctx.globalAlpha = 0.4;
      } else if (ficha.oculto) {
        ctx.globalAlpha = 0.45;
      }

      // Borde exterior / resplandor si está seleccionada
      if (selectedFichasIds.includes(ficha.id)) {
        ctx.shadowColor = '#f0d060';
        ctx.shadowBlur = 15;
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
          img.onload = () => markDirty();
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

      if (ficha.hp_actual <= 0) {
        ctx.globalAlpha = 0.4;
      }

      // Dibujar Borde Dorado del Token (o del color del aro)
      const colorAro = ficha.color_aro || '#c9a84c';
      
      // Si tiene color personalizado, lo hacemos más grueso/aura
      ctx.strokeStyle = colorAro;
      ctx.lineWidth = ficha.color_aro ? 3 : 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      // Si tiene color_aro, le damos un leve resplandor interior/exterior al aro
      if (ficha.color_aro) {
        ctx.strokeStyle = colorAro;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      }

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

      // Reset alpha for following drawings (like dice animations)
      ctx.globalAlpha = 1.0;

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
      const feetPerTile = state.escenaActiva?.config_casilla || state.partida?.config_casilla || 5;
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
        let mult = f.tamanio_base === 'gargantua' ? 4 : f.tamanio_base === 'enorme' ? 3 : f.tamanio_base === 'grande' ? 2 : f.tamanio_base === 'enano' ? 0.75 : 1;
        if (f.gigante) mult *= 2;
        return gridPos.x >= f.x && gridPos.x <= f.x + mult && gridPos.y >= f.y && gridPos.y <= f.y + mult;
      });

      if (clickedFicha) {
        // Verificar permisos: DM o dueño directo de la ficha
        const esDuenio = esDuenioDeFicha(clickedFicha);
        if (esDuenio) {
          const isMulti = e.shiftKey || isMultiSelectMode;
          if (!isMulti && !selectedFichasIds.includes(clickedFicha.id)) {
            selectedFichasIds = [clickedFicha.id];
          } else if (isMulti) {
            if (selectedFichasIds.includes(clickedFicha.id)) {
              selectedFichasIds = selectedFichasIds.filter(id => id !== clickedFicha.id);
            } else {
              selectedFichasIds.push(clickedFicha.id);
            }
          }
          
          updateMultiSelectBadge();
          if (dom.diceTokenSelect) dom.diceTokenSelect.value = selectedFichasIds[0] || '';
          isDraggingToken = selectedFichasIds.length > 0;
          
          dragOffsets = {};
          selectedFichasIds.forEach(id => {
            const f = state.fichas.find(fi => fi.id === id);
            if (f) {
              dragOffsets[id] = { x: gridPos.x - f.x, y: gridPos.y - f.y };
            }
          });
          
          renderFichasList();
          markDirty();
          return;
        }
      }
      // Buscar si hizo clic en figura se hace fuera de este if para que funcione en "figures" también
    } else if (activeTool === 'measure') {
      measureStart = gridPos;
      measureCurrent = gridPos;
    } else if (activeTool === 'draw' && state.usuario.esDM) {
      isDrawing = true;
      currentStroke = [{ x: gridPos.x, y: gridPos.y }];
    }

    // Lógica para seleccionar figuras compartida entre 'move' y 'figures'
    if (activeTool === 'move' || activeTool === 'figures') {
      const clickedFig = (state.figuras || []).find(fig => {
        return gridPos.x >= fig.x - (fig.tamanio || 1) && gridPos.x <= fig.x + (fig.tamanio || 1) &&
          gridPos.y >= fig.y - (fig.tamanio || 1) && gridPos.y <= fig.y + (fig.tamanio || 1);
      });

      if (clickedFig && !isDraggingToken) {
        selectedFigureId = clickedFig.id;

        if (activeTool === 'move') {
          if (state.usuario.esDM || clickedFig.creador_id === state.usuario.id) {
            isDraggingFigure = true;
            dragOffset = { x: gridPos.x - clickedFig.x, y: gridPos.y - clickedFig.y };
          }
        }

        // Poblar la UI con los datos de la figura seleccionada
        if (dom.figType) dom.figType.value = clickedFig.tipo;
        if (dom.figSize) dom.figSize.value = clickedFig.tamanio || 1;
        if (dom.figRotation) dom.figRotation.value = clickedFig.rotacion || 0;
        if (dom.figColor) dom.figColor.value = clickedFig.color || '#c9a84c';
        if (dom.figOpacity) dom.figOpacity.value = clickedFig.transparencia || 0.4;
        if (dom.figLabel) dom.figLabel.value = clickedFig.etiqueta || '';

        markDirty();
        return; // Detenemos aquí para no crear figuras nuevas ni hacer pan
      }
    }

    // Si llegamos aquí y es move, hacemos pan
    if (activeTool === 'move' && !isDraggingToken && !isDraggingFigure) {
      selectedFigureId = null;
      isPanning = true;
      panStart = { x: e.clientX - viewport.panX, y: e.clientY - viewport.panY };
    }

    // Si llegamos aquí y es figures, creamos una nueva
    if (activeTool === 'figures') {
      figureStart = gridPos;
      const newFigId = 'fig_' + Math.random().toString(36).substr(2, 9);
      const nuevaFig = {
        id: newFigId,
        tipo: dom.figType.value,
        x: Math.round(gridPos.x),
        y: Math.round(gridPos.y),
        tamanio: parseFloat(dom.figSize.value),
        rotacion: parseFloat(dom.figRotation?.value || 0),
        color: dom.figColor.value,
        transparencia: parseFloat(dom.figOpacity.value),
        etiqueta: dom.figLabel.value,
        creador_id: state.usuario.id
      };

      // La nueva figura queda seleccionada
      selectedFigureId = newFigId;

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

    if (isDraggingToken && selectedFichasIds.length > 0) {
      const now = Date.now();
      let didMove = false;

      selectedFichasIds.forEach(id => {
        const ficha = state.fichas.find(f => f.id === id);
        if (ficha && dragOffsets[id]) {
          ficha.x = gridPos.x - dragOffsets[id].x;
          ficha.y = gridPos.y - dragOffsets[id].y;
          didMove = true;

          // Emitir posición en tiempo real a la sala (throttled cada 40ms)
          if (now - lastMoveEmitTime > 40) {
            socket?.emit('mover_ficha', {
              partidaId: state.partida.id,
              escenaId: state.escenaActiva.id,
              fichaId: ficha.id,
              x: ficha.x,
              y: ficha.y
            });
          }
        }
      });
      
      if (didMove) {
        if (now - lastMoveEmitTime > 40) {
          lastMoveEmitTime = now;
        }
        markDirty();
      }
    } else if (isDraggingFigure && selectedFigureId) {
      const fig = state.figuras.find(f => f.id === selectedFigureId);
      if (fig) {
        fig.x = gridPos.x - dragOffset.x;
        fig.y = gridPos.y - dragOffset.y;
        markDirty();
      }
    } else if (isPanning) {
      viewport.panX = e.clientX - panStart.x;
      viewport.panY = e.clientY - panStart.y;
      markDirty();
    } else if (activeTool === 'measure' && measureStart) {
      measureCurrent = gridPos;
      markDirty();
    } else if (isDrawing && activeTool === 'draw' && state.usuario.esDM) {
      currentStroke.push({ x: gridPos.x, y: gridPos.y });
      markDirty();
    }
  }

  function handleMouseUp() {
    if (isDraggingToken && selectedFichasIds.length > 0) {
      selectedFichasIds.forEach(id => {
        const ficha = state.fichas.find(f => f.id === id);
        if (ficha) {
          // Snap al grid en números enteros más cercanos
          ficha.x = Math.round(ficha.x);
          ficha.y = Math.round(ficha.y);
          socket?.emit('guardar_posicion_ficha', {
            partidaId: state.partida.id,
            escenaId: state.escenaActiva.id,
            fichaId: ficha.id,
            x: ficha.x,
            y: ficha.y
          });
        }
      });
    }

    if (isDraggingFigure && selectedFigureId) {
      const fig = state.figuras.find(f => f.id === selectedFigureId);
      if (fig) {
        // Snap al grid solo para fichas, no para figuras
        // fig.x = Math.round(fig.x);
        // fig.y = Math.round(fig.y);
        socket?.emit('guardar_figura', {
          partidaId: state.partida.id,
          escenaId: state.escenaActiva.id,
          figuraData: fig
        });
      }
      isDraggingFigure = false;
      markDirty();
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
    markDirty();
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
      markDirty();
      return;
    }

    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    zoomAt(e.clientX, e.clientY, zoomFactor);
  }

  function zoomAt(screenX, screenY, factor) {
    const newZoom = Math.max(0.05, Math.min(4.0, viewport.zoom * factor));
    if (newZoom === viewport.zoom) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = screenX - rect.left;
    const mouseY = screenY - rect.top;

    viewport.panX = mouseX - (mouseX - viewport.panX) * (newZoom / viewport.zoom);
    viewport.panY = mouseY - (mouseY - viewport.panY) * (newZoom / viewport.zoom);
    viewport.zoom = newZoom;

    if (dom.zoomLevelText) dom.zoomLevelText.textContent = `${Math.round(viewport.zoom * 100)}%`;
    markDirty();
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
        markDirty();
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
      markDirty();
    });

    dom.btnSortInitiative?.addEventListener('click', () => {
      if (state.fichas) {
        sortInitiative = !sortInitiative;
        dom.btnSortInitiative.classList.toggle('active', sortInitiative);
        renderFichasList();
      }
    });

    dom.btnMultiSelectMode?.addEventListener('click', () => {
      isMultiSelectMode = !isMultiSelectMode;
      dom.btnMultiSelectMode.classList.toggle('active', isMultiSelectMode);
      updateMultiSelectBadge();
    });

    // Menús y Navegación & Botones Inicio
    dom.btnNavInicio?.addEventListener('click', () => {
      if (state.partida && state.partida.codigo) {
        const salir = confirm('¿Deseas volver a la pantalla de inicio? Tu partida sigue guardada de forma segura.');
        if (!salir) return;
        localStorage.removeItem('vtt_active_game_code');
      }
      autoSaveGame();
      loadGamesList();
      showScreen('start');
    });

    // Guardado de emergencia y acciones de respaldo
    dom.btnEmergencyExport?.addEventListener('click', handleEmergencyExport);
    dom.btnReconnectNow?.addEventListener('click', () => {
      showToast('🔄 Forzando reconexión...', 'info');
      if (socket) {
        socket.disconnect();
        socket.connect();
      } else {
        initSocket();
      }
    });
    dom.btnDmSaveNow?.addEventListener('click', forzarGuardadoManual);
    dom.btnRefreshBackups?.addEventListener('click', loadDmBackupsList);

    // Watchdog de red: si la conexión vuelve o la pestaña recupera foco tras suspensión
    window.addEventListener('online', () => {
      console.log('🌐 Red detectada de nuevo. Verificando estado del socket...');
      if (socket && !socket.connected) {
        socket.connect();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (socket && !socket.connected) {
          console.log('👁️ Pestaña reactivada. Reconectando socket...');
          socket.connect();
        }
      }
    });

    // Atajo de teclado Ctrl+S para guardado forzado manual
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (state.partida && state.partida.id) {
          forzarGuardadoManual();
        }
      }
    });

    if (dom.codeBadge) {
      dom.codeBadge.addEventListener('click', () => {
        if (state.partida?.codigo) {
          navigator.clipboard.writeText(state.partida.codigo);
          alert(`📋 Código ${state.partida.codigo} copiado al portapapeles!`);
        }
      });
    }

    // Modal Crear / Unirse / Importar Partida
    dom.btnCreateGameModal?.addEventListener('click', () => openModal(dom.modalCreateGame));
    dom.btnJoinGameModal?.addEventListener('click', () => openModal(dom.modalJoinGame));

    if (dom.btnImportGame && dom.inputImportGameFile) {
      dom.btnImportGame.addEventListener('click', () => dom.inputImportGameFile.click());
      dom.inputImportGameFile.addEventListener('change', handleImportSessionFile);
    }

    if (dom.btnDmExportSession) {
      dom.btnDmExportSession.addEventListener('click', () => {
        if (state.partida?.id) {
          window.location.href = `/api/partidas/${state.partida.id}/export`;
        }
      });
    }

    if (dom.btnDmImportSession && dom.inputDmImportFile) {
      dom.btnDmImportSession.addEventListener('click', () => dom.inputDmImportFile.click());
      dom.inputDmImportFile.addEventListener('change', handleImportSessionFile);
    }

    dom.formCreateGame?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const titleEl = document.getElementById('create-game-title') || document.getElementById('new-game-name');
      const dmNameEl = document.getElementById('create-dm-name');
      const imgUrlEl = document.getElementById('create-game-img-url') || document.getElementById('new-game-image');
      const imgFileEl = document.getElementById('create-game-img-file');
      
      const nombre = titleEl ? titleEl.value.trim() : 'Nueva Partida';
      const dmName = dmNameEl && dmNameEl.value.trim() ? dmNameEl.value.trim() : (localStorage.getItem('vtt_username') || 'Dungeon Master');
      
      let imagenPortada = imgUrlEl ? imgUrlEl.value.trim() : '';
      if (imgFileEl && imgFileEl.files && imgFileEl.files[0]) {
        try {
          imagenPortada = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(imgFileEl.files[0]);
          });
        } catch (_) {}
      }

      localStorage.setItem('vtt_username', dmName);
      const deterministicId = 'usr_' + dmName.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
      state.usuario.id = deterministicId;
      state.usuario.nombre = dmName;
      localStorage.setItem('vtt_user_id', deterministicId);

      try {
        const res = await fetch('/api/partidas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre, creatorId: state.usuario.id, configGridX: 40, configGridY: 40, imagenPortada })
        });
        if (!res.ok) throw new Error('Error del servidor: ' + res.status);
        const data = await res.json();
        if (!data.codigo) throw new Error('No se recibió código de partida');
        closeModal(dom.modalCreateGame);

        // Unirse automáticamente — espera conexión socket si hace falta
        if (typeof window._emitWhenReady === 'function') {
          window._emitWhenReady('unirse_partida', { codigo: data.codigo, nombreUsuario: dmName, usuarioId: state.usuario.id });
        } else {
          socket?.emit('unirse_partida', { codigo: data.codigo, nombreUsuario: dmName, usuarioId: state.usuario.id });
        }
      } catch (err) {
        alert('Error al crear la partida: ' + err.message);
      }
    });

    dom.formJoinGame?.addEventListener('submit', (e) => {
      e.preventDefault();
      const codigo = document.getElementById('join-code-input').value;
      const nombreUsuario = document.getElementById('join-username-input').value.trim();

      // Guardamos el nombre de usuario localmente para que se auto-rellene en el futuro
      localStorage.setItem('vtt_username', nombreUsuario);

      if (nombreUsuario) {
        const deterministicId = 'usr_' + nombreUsuario.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
        state.usuario.id = deterministicId;
        state.usuario.nombre = nombreUsuario;
        localStorage.setItem('vtt_user_id', deterministicId);
      }

      closeModal(dom.modalJoinGame);
      if (typeof window._emitWhenReady === 'function') {
        window._emitWhenReady('unirse_partida', { codigo, nombreUsuario, usuarioId: state.usuario.id });
      } else {
        socket?.emit('unirse_partida', { codigo, nombreUsuario, usuarioId: state.usuario.id });
      }
    });

    // Herramientas DM (Panel Izquierdo)
    dom.toolButtons?.forEach(btn => {
      btn.addEventListener('click', () => {
        dom.toolButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeTool = btn.dataset.tool;

        // Mostrar opciones de sub-herramienta
        dom.toolOptionsContainer?.classList.add('hidden');
        dom.optDraw?.classList.add('hidden');
        dom.optFigures?.classList.add('hidden');

        if (activeTool === 'draw') {
          dom.toolOptionsContainer?.classList.remove('hidden');
          dom.optDraw?.classList.remove('hidden');
        } else if (activeTool === 'figures') {
          dom.toolOptionsContainer?.classList.remove('hidden');
          dom.optFigures?.classList.remove('hidden');
        }
      });
    });

    dom.btnClearDrawings?.addEventListener('click', () => {
      socket?.emit('limpiar_dibujos', { partidaId: state.partida.id, escenaId: state.escenaActiva.id });
    });

    dom.btnClearFigures?.addEventListener('click', () => {
      if (state.usuario.esDM) {
        socket?.emit('limpiar_figuras', { partidaId: state.partida.id, escenaId: state.escenaActiva.id });
      } else {
        socket?.emit('limpiar_mis_figuras', { partidaId: state.partida.id, escenaId: state.escenaActiva.id, usuarioId: state.usuario.id });
      }
    });

    // Actualizar propiedades de figura en tiempo real
    ['figType', 'figSize', 'figRotation', 'figColor', 'figOpacity', 'figLabel'].forEach(key => {
      if (dom[key]) {
        dom[key].addEventListener('input', () => {
          if (selectedFigureId && activeTool === 'figures') {
            const fig = state.figuras.find(f => f.id === selectedFigureId);
            if (fig && (fig.creador_id === state.usuario.id || state.usuario.esDM)) {
              fig.tipo = dom.figType.value;
              fig.tamanio = parseFloat(dom.figSize.value) || 1;
              fig.rotacion = parseFloat(dom.figRotation.value) || 0;
              fig.color = dom.figColor.value;
              fig.transparencia = parseFloat(dom.figOpacity.value) || 0.4;
              fig.etiqueta = dom.figLabel.value;

              markDirty();

              // Emitir actualización al servidor
              socket?.emit('guardar_figura', {
                partidaId: state.partida.id,
                escenaId: state.escenaActiva.id,
                figuraData: fig
              });
            }
          }
        });
      }
    });

    // Zoom flotante
    dom.btnZoomIn?.addEventListener('click', () => zoomAt(canvas.width / 2, canvas.height / 2, 1.2));
    dom.btnZoomOut?.addEventListener('click', () => zoomAt(canvas.width / 2, canvas.height / 2, 0.8));
    dom.btnZoomReset?.addEventListener('click', () => {
      viewport.zoom = 1.0;
      viewport.panX = 0;
      viewport.panY = 0;
      if (dom.zoomLevelText) dom.zoomLevelText.textContent = '100%';
      markDirty();
    });

    // Pestañas Derechas
    dom.tabButtons?.forEach(btn => {
      btn.addEventListener('click', () => {
        dom.tabButtons.forEach(b => b.classList.remove('active'));
        dom.tabPanes.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const targetPane = document.getElementById(btn.dataset.tab);
        if (targetPane) targetPane.classList.add('active');
      });
    });

    // Fichas
    dom.btnOpenCreateFicha?.addEventListener('click', () => {
      dom.formFicha.reset();
      document.getElementById('ficha-id').value = '';
      dom.fichaImgPreview.src = 'https://via.placeholder.com/100?text=Avatar';
      dom.modalFichaTitle.textContent = 'Crear Nueva Ficha de Personaje';

      // Ocultar opciones de NPC/Monstruo si no es DM
      const fichaTipo = document.getElementById('ficha-tipo');
      if (fichaTipo) {
        Array.from(fichaTipo.options).forEach(opt => {
          if (!state.usuario.esDM && opt.value !== 'jugador') {
            opt.style.display = 'none';
          } else {
            opt.style.display = '';
          }
        });
        if (!state.usuario.esDM) fichaTipo.value = 'jugador';
      }

      openModal(dom.modalFicha);
    });

    dom.fichaImgFile?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          dom.fichaImgPreview.src = evt.target.result;
        };
        reader.readAsDataURL(file);
      }
    });

    dom.fichaImagenUrl?.addEventListener('input', (e) => {
      if (e.target.value) dom.fichaImgPreview.src = e.target.value;
    });

    dom.formFicha?.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = document.getElementById('ficha-id').value;
      const fichaData = {
        id: id || undefined,
        nombre: document.getElementById('ficha-nombre').value,
        tipo: document.getElementById('ficha-tipo').value,
        jugadorId: state.usuario.id,
        imagen: dom.fichaImgPreview.src,
        fuerza: parseNumberSafe(document.getElementById('ficha-fue').value, 10),
        destreza: parseNumberSafe(document.getElementById('ficha-des').value, 10),
        constitucion: parseNumberSafe(document.getElementById('ficha-con').value, 10),
        inteligencia: parseNumberSafe(document.getElementById('ficha-int').value, 10),
        sabiduria: parseNumberSafe(document.getElementById('ficha-sab').value, 10),
        carisma: parseNumberSafe(document.getElementById('ficha-car').value, 10),
        hpActual: parseNumberSafe(document.getElementById('ficha-hp-act').value, 10),
        hpMaximo: parseNumberSafe(document.getElementById('ficha-hp-max').value, 10),
        hp_actual: parseNumberSafe(document.getElementById('ficha-hp-act').value, 10),
        hp_maximo: parseNumberSafe(document.getElementById('ficha-hp-max').value, 10),
        ac: parseNumberSafe(document.getElementById('ficha-ac').value, 10),
        velocidad: parseNumberSafe(document.getElementById('ficha-vel').value, 30),
        iniciativa: parseNumberSafe(document.getElementById('ficha-ini').value, 0),
        nivel: parseNumberSafe(document.getElementById('ficha-nivel').value, 1),
        altura: parseNumberSafe(document.getElementById('ficha-altura').value, 2),
        tamanioBase: document.getElementById('ficha-tamanio').value,
        tamanio_base: document.getElementById('ficha-tamanio').value,
        color_aro: document.getElementById('ficha-color-aro') ? document.getElementById('ficha-color-aro').value : '#c9a84c',
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
    dom.quickDiceButtons?.forEach(btn => {
      btn.addEventListener('click', () => {
        dom.diceFormulaInput.value = btn.dataset.die;
      });
    });

    dom.classifButtons?.forEach(btn => {
      btn.addEventListener('click', () => {
        dom.classifButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentClassif = btn.dataset.classif;
      });
    });

    dom.modeButtons?.forEach(btn => {
      btn.addEventListener('click', () => {
        dom.modeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    dom.btnRollDice?.addEventListener('click', rollDice);

    // Chat
    dom.btnSendChat?.addEventListener('click', sendChatMessage);
    dom.chatTextInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendChatMessage();
    });

    if (dom.btnUploadChatMedia && dom.chatFileInput) {
      dom.btnUploadChatMedia.addEventListener('click', () => {
        dom.chatFileInput.click();
      });

      dom.chatFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            const dataUrl = evt.target.result;
            socket?.emit('enviar_mensaje', {
              partidaId: state.partida?.id,
              usuarioId: state.usuario.id,
              nombreUsuario: state.usuario.nombre,
              colorUsuario: state.usuario.color,
              mensaje: dataUrl,
              esGif: 1
            });
          };
          reader.readAsDataURL(file);
        }
        e.target.value = '';
      });
    }

    // Historial
    dom.btnHistPrev?.addEventListener('click', () => {
      if (historyPage > 1) {
        historyPage--;
        renderHistoryTable();
      }
    });

    dom.btnHistNext?.addEventListener('click', () => {
      if (historyPage * historyPerPage < (state.historial || []).length) {
        historyPage++;
        renderHistoryTable();
      }
    });

    dom.searchHistoryInput?.addEventListener('input', renderHistoryTable);

    dom.btnExportHistory?.addEventListener('click', () => {
      if (state.partida?.id) {
        window.location.href = `/api/partidas/${state.partida.id}/export`;
      }
    });

    dom.btnClearHistory?.addEventListener('click', () => {
      if (confirm('¿Limpiar todo el historial de tiradas de la partida?')) {
        socket?.emit('limpiar_historial', { partidaId: state.partida.id });
      }
    });

    // Panel DM
    dom.btnCreateScene?.addEventListener('click', () => {
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
        dom.mapFileInput?.click();
      });
    }

    dom.mapFileInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        // Si es GIF animado, preservar datos originales para no perder animación
        if (file.type === 'image/gif') {
          const reader = new FileReader();
          reader.onload = (evt) => {
            socket?.emit('actualizar_mapa', { partidaId: state.partida.id, escenaId: state.escenaActiva.id, mapaBase64: evt.target.result });
          };
          reader.readAsDataURL(file);
          return;
        }

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
            const resizedBase64 = canvas.toDataURL('image/jpeg', 0.82);

            socket?.emit('actualizar_mapa', { partidaId: state.partida.id, escenaId: state.escenaActiva.id, mapaBase64: resizedBase64 });
          };
          img.src = evt.target.result;
        };
        reader.readAsDataURL(file);
      }
    });

    dom.btnClearMapBg?.addEventListener('click', () => {
      socket?.emit('actualizar_mapa', { partidaId: state.partida.id, escenaId: state.escenaActiva.id, mapaBase64: null });
    });

    dom.btnApplyGrid?.addEventListener('click', () => {
      const gridX = parseInt(dom.gridColsInput.value) || 40;
      const gridY = parseInt(dom.gridRowsInput.value) || 40;
      const casilla = parseInt(dom.gridFeetInput.value) || 5;

      socket?.emit('actualizar_grid', { partidaId: state.partida.id, escenaId: state.escenaActiva.id, gridX, gridY, casilla });
    });

    dom.btnSaveCurrentTemplate?.addEventListener('click', () => {
      if (selectedFichasIds.length === 0) {
        alert('Por favor selecciona una ficha primero en la pestaña Fichas.');
        return;
      }
      const ficha = state.fichas.find(f => f.id === selectedFichasIds[0]);
      if (ficha) {
        socket?.emit('guardar_galeria', { partidaId: state.partida.id, nombre: ficha.nombre, datos: ficha });
      }
    });

    // Cerrar Modales
    document.querySelectorAll('.btn-close-modal').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const overlay = e.target.closest('.modal-overlay');
        if (overlay) closeModal(overlay);
      });
    });

    const btnSaveRev = dom.btnSaveRevelar || dom.btnAplicarRevelado;
    btnSaveRev?.addEventListener('click', () => {
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
      } else {
        currentFichaReveladoConfig.jugadores[targetJugador] = newConf;
      }

      socket?.emit('actualizar_config_revelado', {
        partidaId: state.partida.id,
        fichaId: fichaId,
        config: currentFichaReveladoConfig
      });

      closeModal(dom.modalRevelar);
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
    if (classif === 'Daño') icon = '⚔️';
    if (classif === 'Iniciativa') icon = '🎯';
    if (classif === 'Curación') icon = '❤️';

    const isDamageOrHeal = (classif === 'Daño' || classif === 'Curación');

    try {
      if (!isDamageOrHeal) {
        if (mode === 'ventaja') {
          rawFormula = rawFormula.replace(/1d20/g, '2d20kh1');
        } else if (mode === 'desventaja') {
          rawFormula = rawFormula.replace(/1d20/g, '2d20kl1');
        }
      }

      const diceResult = evalDiceFormula(rawFormula);
      finalResult = diceResult.total;

      // Construir texto de fórmula con detalle de dados
      let formulaDisplay = originalFormula;
      if (!isDamageOrHeal && mode !== 'normal' && diceResult.rollDetails.length > 0) {
        const modeLabel = mode === 'ventaja' ? '⭐Ventaja' : '🌑Desventaja';
        formulaDisplay = `${originalFormula} [${modeLabel}: ${diceResult.rollDetails.join(', ')}]`;
      } else if (diceResult.rollDetails.length > 0) {
        formulaDisplay = `${originalFormula} [${diceResult.rollDetails.join(', ')}]`;
      }

      // Determinar la ficha objetivo para animación y asignaciones (Iniciativa / Daño / Curación)
      const targetTokenId = fichaId || (selectedFichasIds && selectedFichasIds[0]) || dom.diceTokenSelect?.value || '';

      socket?.emit('lanzar_dados', {
        partidaId: state.partida.id,
        usuarioId: state.usuario.id,
        nombreUsuario: state.usuario.nombre,
        formula: formulaDisplay,
        tipo: classif,
        resultado: finalResult,
        fichaId: targetTokenId || fichaId,
        icono: icon
      });

      // Si la clasificación es Iniciativa, asignar automáticamente la tirada a la ficha seleccionada
      if (classif === 'Iniciativa') {
        if (targetTokenId) {
          const targetFicha = state.fichas.find(f => f.id === targetTokenId);
          if (targetFicha) {
            targetFicha.iniciativa = finalResult;
            socket?.emit('actualizar_ficha', { partidaId: state.partida.id, fichaData: targetFicha });
          }
        } else {
          // Si no hay ficha seleccionada, abrir modal para elegir a quién asignar la iniciativa
          pendingDiceResult = { resultado: finalResult, esCuracion: false, classif: 'Iniciativa' };
          openPostRollTargetModal('Iniciativa', finalResult);
        }
      }

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
    if (!dom.hdTokenSelect || !dom.hdAmountInput) return;
    const fichaId = dom.hdTokenSelect.value;
    const cantidad = parseInt(dom.hdAmountInput.value) || 0;

    if (fichaId && cantidad > 0) {
      socket?.emit('aplicar_dano_curacion', {
        partidaId: state.partida.id,
        fichaId,
        cantidad,
        esCuracion
      });
      if (dom.modalDanoCuracion) closeModal(dom.modalDanoCuracion);
    }
  }

  // --- CHAT ---
  // Regex para detectar URLs de imagen/gif
  const IMAGE_URL_REGEX = /^https?:\/\/\S+\.(gif|png|jpg|jpeg|webp|svg)(\?\S*)?$/i;
  const TENOR_URL_REGEX = /^https?:\/\/(media[0-9]?\.tenor\.com|c\.tenor\.com|tenor\.com\/view)\/\S+/i;
  const GIPHY_URL_REGEX = /^https?:\/\/(media[0-9]?\.giphy\.com|giphy\.com\/gifs)\/\S+/i;
  const IMGBB_REGEX = /^https?:\/\/(i\.ibb\.co|ibb\.co)\/\S+/i;
  const DISCORD_MEDIA_REGEX = /^https?:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\/\S+/i;

  function isImageUrl(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    if (trimmed.startsWith('data:image/')) return true;
    return IMAGE_URL_REGEX.test(trimmed) ||
           TENOR_URL_REGEX.test(trimmed) ||
           GIPHY_URL_REGEX.test(trimmed) ||
           IMGBB_REGEX.test(trimmed) ||
           DISCORD_MEDIA_REGEX.test(trimmed) ||
           /\.(gif|png|jpe?g|webp|svg)(\?.*)?$/i.test(trimmed);
  }

  function sendChatMessage() {
    const mensaje = dom.chatTextInput.value.trim();
    if (!mensaje) return;

    // Detectar automáticamente si es una URL de imagen/GIF
    const esGif = isImageUrl(mensaje);

    socket?.emit('enviar_mensaje', {
      partidaId: state.partida.id,
      usuarioId: state.usuario.id,
      nombreUsuario: state.usuario.nombre,
      colorUsuario: state.usuario.color,
      mensaje,
      esGif
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

    if (msg.es_gif || isImageUrl(msg.mensaje)) {
      const img = document.createElement('img');
      img.src = msg.mensaje;
      img.className = 'chat-gif-img';
      img.style.maxWidth = '100%';
      img.style.maxHeight = '200px';
      img.style.borderRadius = '6px';
      img.style.marginTop = '4px';
      img.style.cursor = 'pointer';
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
      selectedFichasIds = [ficha.id];
      markDirty();
    }
  }

  function scrollChatToBottom() {
    dom.chatMessagesContainer.scrollTop = dom.chatMessagesContainer.scrollHeight;
  }

  // --- RENDERIZADO DE LISTAS E INTERFAZ ---

  function updateUIForCurrentGame() {
    if (!state.partida) return;
    const nombreLimpio = limpiarNombrePartida(state.partida.nombre);
    state.partida.nombre = nombreLimpio;
    dom.navGameTitle.textContent = nombreLimpio;
    document.title = `${nombreLimpio} - VTT D&D 5e`;
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

    dom.gridColsInput.value = state.escenaActiva?.config_grid_x || state.partida.config_grid_x || 40;
    dom.gridRowsInput.value = state.escenaActiva?.config_grid_y || state.partida.config_grid_y || 40;
    dom.gridFeetInput.value = state.escenaActiva?.config_casilla || state.partida.config_casilla || 5;

    renderFichasList();
    renderTokenSelects();
    renderScenesList();
    renderGalleryChips();
    renderChatMessages();
    renderHistoryTable();
    renderQuickHistory();
    renderDmPlayersList();
  }

  function renderDmPlayersList() {
    if (!dom.dmPlayersList) return;
    dom.dmPlayersList.innerHTML = '';
    (state.jugadoresConectados || []).forEach(j => {
      const isMe = j.id === state.usuario.id;
      const btnMakeDM = state.usuario.esDM && !j.esDM ? `<button class="btn btn-sm btn-primary btn-make-dm" style="margin-left:8px;" data-id="${j.id}">Hacer DM</button>` : '';
      const btnRemoveDM = state.usuario.esDM && j.esDM && !isMe ? `<button class="btn btn-sm btn-danger btn-remove-dm" style="margin-left:8px;" data-id="${j.id}">Quitar DM</button>` : '';
      
      const div = document.createElement('div');
      div.className = 'dm-player-item';
      div.style = 'display: flex; justify-content: space-between; align-items: center; padding: 5px; background: rgba(0,0,0,0.3); border-radius: 4px;';
      div.innerHTML = `
        <span><i class="fa-solid fa-user${j.esDM ? '-shield gold-text' : ''}"></i> ${j.nombre}</span>
        <div>${btnMakeDM}${btnRemoveDM}</div>
      `;
      
      const btnMake = div.querySelector('.btn-make-dm');
      if (btnMake) {
        btnMake.addEventListener('click', () => {
          socket?.emit('toggle_dm', { partidaId: state.partida.id, targetUsuarioId: j.id, makeDM: true });
        });
      }
      
      const btnRemove = div.querySelector('.btn-remove-dm');
      if (btnRemove) {
        btnRemove.addEventListener('click', () => {
          socket?.emit('toggle_dm', { partidaId: state.partida.id, targetUsuarioId: j.id, makeDM: false });
        });
      }
      
      dom.dmPlayersList.appendChild(div);
    });
  }

  function renderFichasList() {
    dom.fichasList.innerHTML = '';
    const filter = dom.filterFichasInput.value.toLowerCase();

    let listToRender = [...(state.fichas || [])].filter(f => f.tipo === 'jugador' || f.escena_id === state.escenaActiva?.id);
    // Filtrar fichas ocultas para jugadores
    if (!state.usuario.esDM) {
      listToRender = listToRender.filter(f => !f.oculto || esDuenioDeFicha(f));
    }

    if (sortInitiative) {
      listToRender.sort((a, b) => (b.iniciativa || 0) - (a.iniciativa || 0));
    }

    // Si sortInitiative está activo, asegurar que el botón se vea activo
    if (dom.btnSortInitiative) {
      dom.btnSortInitiative.classList.toggle('active', sortInitiative);
    }

    listToRender.forEach(ficha => {
      if (filter && !ficha.nombre.toLowerCase().includes(filter)) return;

      const card = document.createElement('div');
      card.className = `ficha-card ${selectedFichasIds.includes(ficha.id) ? 'selected' : ''} ${ficha.oculto ? 'ficha-oculta' : ''}`;

      const isMonster = ficha.tipo === 'monstruo' || ficha.tipo === 'npc';
      const isPlayerView = !state.usuario.esDM;
      const visibility = getFichaVisibility(ficha);

      const hpText = (isMonster && isPlayerView && !visibility.hp) ? '???' : `${ficha.hp_actual}/${ficha.hp_maximo}`;
      const acText = (isMonster && isPlayerView && !visibility.ac) ? '???' : ficha.ac;
      const iniText = ficha.iniciativa || 0;
      const avatarSrc = (isMonster && isPlayerView && !visibility.imagen) ? 'https://via.placeholder.com/48?text=?' : (ficha.imagen || 'https://via.placeholder.com/48?text=Avatar');

      const esPropietario = esDuenioDeFicha(ficha);
      const ocultoBadge = (state.usuario.esDM && ficha.oculto) ? `<span style="background:#555; color:#f87171; font-size:0.75rem; padding:2px 6px; border-radius:4px; margin-left:6px;"><i class="fa-solid fa-eye-slash"></i> Oculto</span>` : '';

      card.innerHTML = `
        <div class="ficha-card-header">
          <img src="${avatarSrc}" class="ficha-avatar" style="cursor: pointer;" title="Haz clic para ampliar">
          <div class="ficha-info">
            <div class="ficha-name">${ficha.nombre} ${ocultoBadge}</div>
            <div class="ficha-sub">${ficha.tipo.toUpperCase()} | HP: ${hpText} | AC: ${acText} | INI: <strong class="gold-text">${iniText}</strong></div>
            <div class="hp-bar-outer">
              <div class="hp-bar-inner" style="width: ${Math.max(0, Math.min(100, (ficha.hp_actual / (ficha.hp_maximo || 1)) * 100))}%"></div>
            </div>
          </div>
        </div>
        <div class="ficha-actions">
          ${esPropietario ? '<button class="btn btn-sm btn-secondary btn-gigante"><i class="fa-solid fa-up-right-and-down-left-from-center"></i> Gigante</button>' : ''}
          ${state.usuario.esDM ? `<button class="btn btn-sm btn-secondary btn-toggle-oculto" title="${ficha.oculto ? 'Mostrar en mapa a jugadores' : 'Ocultar en mapa a jugadores'}"><i class="fa-solid ${ficha.oculto ? 'fa-eye' : 'fa-eye-slash'}"></i> ${ficha.oculto ? 'Mostrar' : 'Ocultar'}</button>` : ''}
          ${state.usuario.esDM && isMonster ? `<button class="btn btn-sm btn-primary btn-revelar-menu"><i class="fa-solid fa-eye"></i> Visibilidad</button>` : ''}
          ${esPropietario ? '<button class="btn btn-sm btn-primary btn-edit-ficha"><i class="fa-solid fa-pen"></i> Editar</button>' : ''}
          ${state.usuario.esDM ? '<button class="btn btn-sm btn-danger btn-del-ficha"><i class="fa-solid fa-trash"></i></button>' : ''}
        </div>
      `;

      const avatarImg = card.querySelector('.ficha-avatar');
      if (avatarImg) {
        avatarImg.addEventListener('click', () => {
          dom.enlargedGifImg.src = avatarSrc;
          if (dom.enlargedImgTitle) {
            dom.enlargedImgTitle.textContent = ficha.nombre;
          }
          if (dom.enlargedImgNotas) {
            const showNotas = state.usuario.esDM || !isMonster || visibility.notas;
            if (showNotas && ficha.notas && ficha.notas.trim() !== '') {
              dom.enlargedImgNotas.textContent = ficha.notas;
              dom.enlargedImgNotas.style.display = 'block';
            } else {
              dom.enlargedImgNotas.style.display = 'none';
              dom.enlargedImgNotas.textContent = '';
            }
          }
          openModal(dom.modalGifView);
        });
      }

      card.querySelector('.btn-toggle-oculto')?.addEventListener('click', () => {
        socket?.emit('toggle_oculto', { partidaId: state.partida.id, fichaId: ficha.id });
      });

      if (esPropietario) {
        card.querySelector('.btn-gigante')?.addEventListener('click', () => {
          socket?.emit('toggle_gigante', { partidaId: state.partida.id, fichaId: ficha.id });
        });

        card.querySelector('.btn-edit-ficha')?.addEventListener('click', () => {
          document.getElementById('ficha-id').value = ficha.id;
          document.getElementById('ficha-nombre').value = ficha.nombre;
          document.getElementById('ficha-tipo').value = ficha.tipo;
          dom.fichaImgPreview.src = ficha.imagen || 'https://via.placeholder.com/100?text=Avatar';
          document.getElementById('ficha-fue').value = ficha.fuerza ?? 10;
          document.getElementById('ficha-des').value = ficha.destreza ?? 10;
          document.getElementById('ficha-con').value = ficha.constitucion ?? 10;
          document.getElementById('ficha-int').value = ficha.inteligencia ?? 10;
          document.getElementById('ficha-sab').value = ficha.sabiduria ?? 10;
          document.getElementById('ficha-car').value = ficha.carisma ?? 10;
          document.getElementById('ficha-hp-act').value = ficha.hp_actual ?? 10;
          document.getElementById('ficha-hp-max').value = ficha.hp_maximo ?? 10;
          document.getElementById('ficha-ac').value = ficha.ac ?? 10;
          document.getElementById('ficha-vel').value = ficha.velocidad ?? 30;
          document.getElementById('ficha-ini').value = ficha.iniciativa ?? 0;
          document.getElementById('ficha-nivel').value = ficha.nivel ?? 1;
          document.getElementById('ficha-altura').value = ficha.altura ?? 2;
          document.getElementById('ficha-tamanio').value = ficha.tamanio_base || 'mediano';
          if (document.getElementById('ficha-color-aro')) document.getElementById('ficha-color-aro').value = ficha.color_aro || '#c9a84c';
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

      card.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('img')) return;
        
        const isMulti = e.shiftKey || isMultiSelectMode;
        if (isMulti) {
          if (selectedFichasIds.includes(ficha.id)) {
            selectedFichasIds = selectedFichasIds.filter(id => id !== ficha.id);
          } else {
            selectedFichasIds.push(ficha.id);
          }
        } else {
          selectedFichasIds = [ficha.id];
        }
        
        updateMultiSelectBadge();
        if (dom.diceTokenSelect) dom.diceTokenSelect.value = selectedFichasIds[0] || '';
        renderFichasList();
        markDirty();
      });

      dom.fichasList.appendChild(card);
    });
  }

  function renderTokenSelects() {
    if (!dom.diceTokenSelect) return;
    dom.diceTokenSelect.innerHTML = '<option value="">-- Sin ficha (Jugador) --</option>';

    (state.fichas || []).filter(f => f.tipo === 'jugador' || f.escena_id === state.escenaActiva?.id).forEach(f => {
      const esPropia = esDuenioDeFicha(f);

      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.nombre;

      if (esPropia || state.usuario.esDM) {
        dom.diceTokenSelect.appendChild(opt.cloneNode(true));
      }
    });
  }

  // Modal post-lanzamiento para elegir objetivo de iniciativa
  function openPostRollTargetModal(classif, resultado) {
    const modal = document.getElementById('modal-post-roll-target');
    if (!modal) return;

    const titleEl = modal.querySelector('.post-roll-title');
    const listEl = modal.querySelector('.post-roll-target-list');
    const resultEl = modal.querySelector('.post-roll-result');
    const iconEl = modal.querySelector('.post-roll-icon');

    if (iconEl) iconEl.textContent = '🎯';
    if (titleEl) titleEl.textContent = '¿A quién asignar iniciativa?';
    if (resultEl) resultEl.textContent = `Resultado del dado: ${resultado}`;

    listEl.innerHTML = '';

    (state.fichas || []).filter(f => f.tipo === 'jugador' || f.escena_id === state.escenaActiva?.id).forEach(f => {
      if (!state.usuario.esDM && f.oculto && !esDuenioDeFicha(f)) return;

      const hpPercent = Math.max(0, Math.min(100, (f.hp_actual / (f.hp_maximo || 1)) * 100));

      const btn = document.createElement('button');
      btn.className = 'post-roll-target-btn';
      btn.innerHTML = `
        <span class="post-roll-target-name">${f.nombre}</span>
        <span class="post-roll-target-hp">HP: ${f.hp_actual}/${f.hp_maximo}</span>
        <div class="post-roll-hp-bar"><div class="post-roll-hp-fill" style="width: ${hpPercent}%"></div></div>
      `;
      btn.addEventListener('click', () => {
        if (pendingDiceResult) {
          f.iniciativa = pendingDiceResult.resultado;
          socket?.emit('actualizar_ficha', { partidaId: state.partida.id, fichaData: f });
          pendingDiceResult = null;
        }
        closeModal(modal);
      });
      listEl.appendChild(btn);
    });

    openModal(modal);
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
        const posicionesActuales = (state.fichas || []).map(f => ({
          fichaId: f.id,
          x: f.x,
          y: f.y
        }));
        socket?.emit('cambiar_escena', {
          partidaId: state.partida.id,
          escenaId: sc.id,
          escenaAnteriorId: state.escenaActiva?.id,
          posicionesActuales
        });
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
    if (!dom.gamesList) return;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch('/api/partidas', { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error('Respuesta no OK: ' + res.status);
      const partidas = await res.json();

      dom.gamesList.innerHTML = '';

      if (partidas.length === 0) {
        dom.gamesList.innerHTML = '<div class="empty-state">No hay partidas guardadas. ¡Crea una nueva partida arriba!</div>';
        return;
      }

      partidas.forEach(p => {
        const card = document.createElement('div');
        card.className = 'game-card';
        const imagenHtml = p.imagen_portada ? `<img src="${p.imagen_portada}" alt="Portada" style="width: 100%; height: 120px; object-fit: cover; border-radius: 4px; margin-bottom: 8px;">` : '';
        const nombreLimpio = limpiarNombrePartida(p.nombre);
        p.nombre = nombreLimpio;
        card.innerHTML = `
          ${imagenHtml}
          <div class="card-title">${nombreLimpio}</div>
          <div class="card-meta">
            <span>Code: <strong>${p.codigo}</strong></span>
            <span>Jugadores: ${p.total_jugadores || 1}</span>
          </div>
          <div class="card-meta">
            <span>Editado: ${new Date(p.fecha_modificacion).toLocaleDateString()}</span>
          </div>
          <div class="card-actions">
            <button class="btn btn-primary btn-sm btn-load-game flex-1">Cargar Partida</button>
            <button class="btn btn-secondary btn-sm btn-export-game" title="Guardar Sesión en Escritorio"><i class="fa-solid fa-download"></i></button>
            <button class="btn btn-danger btn-sm btn-del-game"><i class="fa-solid fa-trash"></i></button>
          </div>
        `;

        card.querySelector('.btn-load-game').addEventListener('click', () => {
          document.getElementById('join-code-input').value = p.codigo;
          document.getElementById('join-username-input').value = localStorage.getItem('vtt_username') || '';
          openModal(dom.modalJoinGame);
        });

        card.querySelector('.btn-export-game')?.addEventListener('click', () => {
          window.location.href = `/api/partidas/${p.id}/export`;
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

  async function handleImportSessionFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const backupData = JSON.parse(text);

      const res = await fetch('/api/partidas/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backupData)
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Error al importar');
      }

      const data = await res.json();
      alert(`✅ Sesión cargada con éxito! Código de partida: ${data.codigo}`);

      // Si estamos en la pantalla de inicio, recargar la lista de partidas
      loadGamesList();

      // Auto unirse a la partida
      const username = localStorage.getItem('vtt_username') || 'Dungeon Master';
      socket?.emit('unirse_partida', { codigo: data.codigo, nombreUsuario: username, usuarioId: state.usuario.id });
    } catch (err) {
      alert(`❌ Error al importar la sesión: ${err.message}`);
    } finally {
      e.target.value = '';
    }
  }

  // --- GESTIÓN DE AUTO-GUARDADO Y RESILIENCIA ANTE CAÍDAS ---
  function saveLocalMirrorBackup() {
    if (!state.partida || !state.partida.codigo) return;
    try {
      // Snapshot ligero para localStorage: omitir mapas base64 pesados e imágenes de galería
      // para evitar bloqueos en el hilo UI del navegador y excepciones de cuota
      const mirrorData = {
        version: '2.0.0-local',
        fecha: new Date().toISOString(),
        partida: state.partida,
        escenaActiva: state.escenaActiva ? {
          id: state.escenaActiva.id,
          partida_id: state.escenaActiva.partida_id,
          nombre: state.escenaActiva.nombre,
          config_grid_x: state.escenaActiva.config_grid_x,
          config_grid_y: state.escenaActiva.config_grid_y,
          config_casilla: state.escenaActiva.config_casilla
        } : null,
        escenas: (state.escenas || []).map(sc => ({
          id: sc.id,
          partida_id: sc.partida_id,
          nombre: sc.nombre,
          config_grid_x: sc.config_grid_x,
          config_grid_y: sc.config_grid_y,
          config_casilla: sc.config_casilla
        })),
        fichas: state.fichas,
        figuras: state.figuras,
        dibujos: state.dibujos,
        mensajes: (state.mensajes || []).slice(-30),
        historial: (state.historial || []).slice(-30),
        galeria: []
      };
      localStorage.setItem('vtt_local_mirror_' + state.partida.codigo, JSON.stringify(mirrorData));
    } catch (e) {
      console.warn('[VTT] Aviso: No se pudo escribir snapshot en localStorage:', e);
    }
  }

  let localMirrorTimer = null;
  function debounceLocalMirrorSave() {
    if (localMirrorTimer) clearTimeout(localMirrorTimer);
    localMirrorTimer = setTimeout(saveLocalMirrorBackup, 3500);
  }

  function forzarGuardadoManual() {
    if (!state.partida?.id) return;
    showSaveIndicator('💾 Guardando...');
    saveLocalMirrorBackup();
    socket?.emit('forzar_guardado', { partidaId: state.partida.id });
    showToast('💾 Guardado manual ejecutado (Servidor y Navegador).', 'success');
  }

  function handleEmergencyExport() {
    if (!state.partida) {
      alert('No hay partida activa para exportar.');
      return;
    }
    const data = {
      version: '2.0.0-emergencia',
      fechaExport: new Date().toISOString(),
      partida: state.partida,
      escenas: state.escenas,
      fichas: state.fichas,
      figuras: state.figuras,
      dibujos: state.dibujos,
      mensajes: state.mensajes,
      historial: state.historial,
      galeria: state.galeria
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeTitle = (state.partida.nombre || 'partida').replace(/[^a-zA-Z0-9_\-]/g, '_');
    a.download = `emergencia_${safeTitle}_${state.partida.codigo}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('💾 Copia de seguridad de emergencia descargada.', 'success');
  }

  async function loadDmBackupsList() {
    if (!dom.dmBackupsList || !state.partida?.codigo) return;
    try {
      dom.dmBackupsList.innerHTML = '<div style="font-size:0.8rem; color:#94a3b8; padding:4px;">Cargando snapshots...</div>';
      const res = await fetch(`/api/partidas/${state.partida.codigo}/backups`);
      if (!res.ok) throw new Error('Error al cargar backups');
      const backups = await res.json();

      dom.dmBackupsList.innerHTML = '';
      if (!Array.isArray(backups) || backups.length === 0) {
        dom.dmBackupsList.innerHTML = '<div style="font-size:0.8rem; color:#64748b; padding:4px;">No hay snapshots aún. Se crean automáticamente.</div>';
        return;
      }

      backups.forEach(b => {
        const item = document.createElement('div');
        item.className = 'backup-item';
        const dateFormatted = new Date(b.fecha).toLocaleTimeString() + ' (' + new Date(b.fecha).toLocaleDateString() + ')';
        const isMain = b.tipo === 'principal';
        item.innerHTML = `
          <div class="backup-info">
            <span class="backup-name">${isMain ? '⭐ Guardado Principal' : '🕒 Snapshot'} (${b.tamanoKb} KB)</span>
            <span class="backup-date">${dateFormatted}</span>
          </div>
          <button class="btn btn-sm btn-gold btn-restore-snapshot" title="Restaurar esta versión">
            <i class="fa-solid fa-rotate-left"></i> Restaurar
          </button>
        `;

        item.querySelector('.btn-restore-snapshot').addEventListener('click', async () => {
          if (confirm(`¿Restaurar la partida al punto del ${dateFormatted}? Se sobrescribirá el estado con este respaldo.`)) {
            try {
              const r = await fetch(`/api/partidas/${state.partida.codigo}/backups/restaurar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: b.nombreArchivo })
              });
              if (!r.ok) {
                const errJson = await r.json();
                throw new Error(errJson.error || 'Error al restaurar');
              }
              showToast('✅ Partida cargada con éxito.', 'success');
              socket?.emit('unirse_partida', {
                codigo: state.partida.codigo,
                nombreUsuario: state.usuario.nombre,
                usuarioId: state.usuario.id
              });
            } catch (err) {
              alert('❌ Error al restaurar: ' + err.message);
            }
          }
        });

        dom.dmBackupsList.appendChild(item);
      });
    } catch (err) {
      dom.dmBackupsList.innerHTML = '<div style="font-size:0.8rem; color:#ef4444; padding:4px;">Error al obtener snapshots.</div>';
    }
  }

  function showToast(message, type = 'success', duration = 3500) {
    if (!dom.toastContainer) dom.toastContainer = document.getElementById('toast-container');
    if (!dom.toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = 'fa-circle-check';
    if (type === 'warning') icon = 'fa-triangle-exclamation';
    if (type === 'error') icon = 'fa-circle-xmark';

    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    dom.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  function autoSaveGame() {
    if (state.partida?.id) {
      saveLocalMirrorBackup();
      socket?.emit('guardado_automatico', { partidaId: state.partida.id });
      showSaveIndicator('Guardado');
    }
  }

  function setupAutoSave() {
    // Guardado automático periódico cada 30 segundos si hay partida activa
    setInterval(() => {
      if (state.partida?.id && socket?.connected) {
        autoSaveGame();
      }
    }, 30000);
  }

  function showSaveIndicator(text) {
    if (dom.saveStatusIndicator) {
      dom.saveStatusIndicator.querySelector('span').textContent = text;
      dom.saveStatusIndicator.classList.add('saving');
      if (!text.includes('🔴')) {
        setTimeout(() => dom.saveStatusIndicator.classList.remove('saving'), 2000);
      }
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
    } catch (e) {
      const isRevealed = ficha.revelado === 1 || ficha.revelado === '1' || ficha.revelado === true;
      config = { global: { imagen: isRevealed, nombre: isRevealed, hp: isRevealed, ac: isRevealed, notas: isRevealed }, jugadores: {} };
    }
    if (!config || !config.global) {
      config = { global: { imagen: false, nombre: false, hp: false, ac: false, notas: false }, jugadores: {} };
    }

    currentFichaReveladoConfig = config;

    // Llenar select de jugadores conectados
    dom.revJugadoresSelect.innerHTML = '<option value="todos">Todos los Jugadores (Global)</option>';
    (state.jugadoresConectados || []).forEach(j => {
      if (!j.esDM) {
        const opt = document.createElement('option');
        opt.value = j.id;
        opt.textContent = j.nombre;
        dom.revJugadoresSelect.appendChild(opt);
      }
    });

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

  // --- MULTISELECCIÓN EN MÓVIL Y CANVAS ---
  function updateMultiSelectBadge() {
    if (!dom.multiSelectCount) return;
    if (selectedFichasIds.length > 0) {
      dom.multiSelectCount.textContent = `${selectedFichasIds.length} sel.`;
      dom.multiSelectCount.classList.remove('hidden');
    } else {
      dom.multiSelectCount.classList.add('hidden');
    }
  }

})();
