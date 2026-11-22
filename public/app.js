/* ==========================================================================
   VTT D&D 5e - CLIENT CORE ENGINE (app.js)
   Manejo de Canvas, Drag & Drop (Mouse + Touch), Sockets, Dados, Chat y DM Tools
   ========================================================================== */

(function () {
  'use strict';

  // --- ESTADO GLOBAL CLIENTE ---
  let socket = null;
  let dom = {};

  let state = {
    partida: null,
    escenaActiva: null,
    escenaPreparacion: null, // Escena que el DM está preparando/editando en privado
    escenas: [],
    fichas: [],
    figuras: [],
    dibujos: [],
    props: [], // Capas / Objetos de utilería (Props) en la escena actual
    mensajes: [],
    historial: [],
    galeria: [],
    combate: { activo: false, ronda: 1, turnoIndex: 0, participantes: [] },
    jugadoresConectados: [],
    usuario: { id: null, nombre: '', esDM: false, color: '#c9a84c' },
    experimentalPropsEnabled: false,
    alphaTokenEffects: localStorage.getItem('vtt_alpha_token_effects') !== 'false',
    autoDiceEffects: localStorage.getItem('vtt_auto_dice_effects') !== 'false',
    customEffectsCatalog: []
  };

  // Helper para obtener la escena actualmente visualizada en pantalla
  function getEscenaActual() {
    return (state.usuario?.esDM && state.escenaPreparacion) ? state.escenaPreparacion : state.escenaActiva;
  }

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

  // --- CATÁLOGO OFICIAL DE CONDICIONES Y BUFFS D&D 5E (ALPHA) ---
  const CONDICIONES_DND5E = [
    {
      id: 'blinded',
      nombre: 'Cegado (Blinded)',
      icono: '🙈',
      color: '#64748b',
      descripcion: 'Falla automáticamente pruebas de vista. Desventaja en ataques. Ataques contra la criatura tienen ventaja.',
      ajusteDado: 'desventaja',
      tipoDado: 'ataque',
      origen: 'dnd5e'
    },
    {
      id: 'charmed',
      nombre: 'Hechizado (Charmed)',
      icono: '💖',
      color: '#ec4899',
      descripcion: 'No puede atacar a quien lo hechizó. Quien lo hechizó tiene ventaja en pruebas sociales contra él.',
      ajusteDado: 'ninguno',
      origen: 'dnd5e'
    },
    {
      id: 'deafened',
      nombre: 'Ensordecido (Deafened)',
      icono: '👂',
      color: '#94a3b8',
      descripcion: 'Falla automáticamente pruebas que requieran oír.',
      ajusteDado: 'ninguno',
      origen: 'dnd5e'
    },
    {
      id: 'frightened',
      nombre: 'Asustado (Frightened)',
      icono: '😱',
      color: '#8b5cf6',
      descripcion: 'Desventaja en pruebas de característica y ataques mientras la fuente del miedo esté a la vista. No puede acercarse a ella.',
      ajusteDado: 'desventaja',
      tipoDado: 'ataque_y_pruebas',
      origen: 'dnd5e'
    },
    {
      id: 'grappled',
      nombre: 'Agarrado (Grappled)',
      icono: '✊',
      color: '#f59e0b',
      descripcion: 'Velocidad 0. Termina si el atacante queda incapacitado o si un efecto aleja al objetivo de su alcance.',
      ajusteDado: 'ninguno',
      origen: 'dnd5e'
    },
    {
      id: 'incapacitated',
      nombre: 'Incapacitado (Incapacitated)',
      icono: '🚫',
      color: '#ef4444',
      descripcion: 'No puede realizar acciones ni reacciones de ningún tipo.',
      ajusteDado: 'ninguno',
      origen: 'dnd5e'
    },
    {
      id: 'invisible',
      nombre: 'Invisible',
      icono: '👻',
      color: '#06b6d4',
      descripcion: 'Imposible de ver sin magia o visión especial. Ventaja en tiradas de ataque. Ataques contra él tienen desventaja.',
      ajusteDado: 'ventaja',
      tipoDado: 'ataque',
      origen: 'dnd5e'
    },
    {
      id: 'paralyzed',
      nombre: 'Paralizado (Paralyzed)',
      icono: '⚡',
      color: '#eab308',
      descripcion: 'Incapacitado, no puede moverse ni hablar. Falla salvaciones de FUE y DES. Ataques contra él tienen ventaja y a 5 ft son críticos automáticos.',
      ajusteDado: 'ninguno',
      origen: 'dnd5e'
    },
    {
      id: 'petrified',
      nombre: 'Petrificado (Petrified)',
      icono: '🗿',
      color: '#78716c',
      descripcion: 'Transformado en piedra. Peso x10. Incapacitado. Resistencia a todo daño. Inmune a veneno.',
      ajusteDado: 'ninguno',
      origen: 'dnd5e'
    },
    {
      id: 'poisoned',
      nombre: 'Envenenado (Poisoned)',
      icono: '🧪',
      color: '#10b981',
      descripcion: 'Desventaja en tiradas de ataque y pruebas de característica.',
      ajusteDado: 'desventaja',
      tipoDado: 'ataque_y_pruebas',
      origen: 'dnd5e'
    },
    {
      id: 'prone',
      nombre: 'Derribado (Prone)',
      icono: '🛌',
      color: '#d97706',
      descripcion: 'Solo puede arrastrarse o gastar mitad de movimiento para levantarse. Desventaja en ataques. Ataques a 5 ft tienen ventaja, a más de 5 ft desventaja.',
      ajusteDado: 'desventaja',
      tipoDado: 'ataque',
      origen: 'dnd5e'
    },
    {
      id: 'restrained',
      nombre: 'Apresado (Restrained)',
      icono: '🕸️',
      color: '#6366f1',
      descripcion: 'Velocidad 0. Desventaja en ataques y salvaciones de DES. Ataques contra él tienen ventaja.',
      ajusteDado: 'desventaja',
      tipoDado: 'ataque',
      origen: 'dnd5e'
    },
    {
      id: 'stunned',
      nombre: 'Aturdido (Stunned)',
      icono: '💫',
      color: '#a855f7',
      descripcion: 'Incapacitado, no puede moverse. Falla salvaciones de FUE y DES. Ataques contra él tienen ventaja.',
      ajusteDado: 'ninguno',
      origen: 'dnd5e'
    },
    {
      id: 'unconscious',
      nombre: 'Inconsciente (Unconscious)',
      icono: '💤',
      color: '#dc2626',
      descripcion: 'Incapacitado, derribado, suelta lo que sostiene. Falla salvaciones de FUE y DES. Ataques contra él tienen ventaja y a 5 ft son críticos automáticos.',
      ajusteDado: 'ninguno',
      origen: 'dnd5e'
    },
    {
      id: 'exhaustion',
      nombre: 'Agotamiento (Exhaustion)',
      icono: '😫',
      color: '#b45309',
      descripcion: 'Niveles 1 a 6. Aplica desventaja acumulativa en pruebas, ataques y salvaciones.',
      ajusteDado: 'desventaja',
      tipoDado: 'ataque_y_pruebas',
      origen: 'dnd5e'
    },
    {
      id: 'bless',
      nombre: 'Bendición (Bless)',
      icono: '✨',
      color: '#38bdf8',
      descripcion: 'Suma +1d4 a tiradas de ataque y tiradas de salvación.',
      ajusteDado: '+1d4',
      tipoDado: 'ataque_y_salvacion',
      origen: 'dnd5e'
    },
    {
      id: 'bane',
      nombre: 'Perdición (Bane)',
      icono: '💀',
      color: '#991b1b',
      descripcion: 'Resta 1d4 (-1d4) a tiradas de ataque y tiradas de salvación.',
      ajusteDado: '-1d4',
      tipoDado: 'ataque_y_salvacion',
      origen: 'dnd5e'
    },
    {
      id: 'rage',
      nombre: 'Furia (Rage)',
      icono: '😡',
      color: '#ea580c',
      descripcion: 'Ventaja en pruebas y salvaciones de Fuerza. Bono al daño con Fuerza. Resistencia a daño físico.',
      ajusteDado: 'ventaja',
      tipoDado: 'fuerza',
      origen: 'dnd5e'
    },
    {
      id: 'concentration',
      nombre: 'Concentración',
      icono: '🧘',
      color: '#0284c7',
      descripcion: 'Manteniendo un conjuro. Debe superar salvación de CON al recibir daño (CD 10 o mitad del daño recibido).',
      ajusteDado: 'ninguno',
      origen: 'dnd5e'
    },
    {
      id: 'haste',
      nombre: 'Acelerar (Haste)',
      icono: '💨',
      color: '#14b8a6',
      descripcion: 'Velocidad x2, +2 CA, ventaja en salvaciones de DES, acción adicional por turno.',
      ajusteDado: 'ninguno',
      origen: 'dnd5e'
    },
    {
      id: 'advantage_custom',
      nombre: 'Ventaja (Inspiración)',
      icono: '⭐',
      color: '#eab308',
      descripcion: 'La siguiente tirada de d20 se realiza con ventaja (2d20kh1).',
      ajusteDado: 'ventaja',
      tipoDado: 'todos',
      origen: 'dnd5e'
    },
    {
      id: 'disadvantage_custom',
      nombre: 'Desventaja',
      icono: '🌑',
      color: '#475569',
      descripcion: 'La siguiente tirada de d20 se realiza con desventaja (2d20kl1).',
      ajusteDado: 'desventaja',
      tipoDado: 'todos',
      origen: 'dnd5e'
    }
  ];

  const effectImageCache = new Map();
  function getEffectImageCached(url) {
    if (!url) return null;
    if (effectImageCache.has(url)) return effectImageCache.get(url);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    effectImageCache.set(url, img);
    return img;
  }

  let viewport = {
    zoom: 1.0,
    panX: 0,
    panY: 0,
    tileSize: 50 // Pixeles por casilla base
  };
  let viewportInitializedForScene = null;

  let activeTool = 'move'; // 'move', 'measure', 'draw', 'erase', 'figures', 'healdamage'
  let selectedFichasIds = [];
  let isMultiSelectMode = false;
  let galleryFilterText = '';
  let galleryFilterType = 'all';
  let gallerySpawnQuantity = 1;
  let inspectingTemplateData = null;
  let isDraggingToken = false;
  let tokenDidActuallyMove = false;
  let dragOffsets = {};
  let isDraggingFigure = false;
  let figureDidActuallyMove = false;
  let selectedFigureId = null;
  let dragOffset = { x: 0, y: 0 }; // Para arrastrar figuras individuales

  // Estado de Capas y Utilería (Props)
  let propImagesCache = {};
  let isDraggingProp = false;
  let propDidActuallyMove = false;
  let selectedPropId = null;
  let propDragOffset = { x: 0, y: 0 };

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

  // Helper para comprimir y redimensionar imágenes subidas antes de enviarlas o guardarlas en base de datos
  async function compressImageFile(file, maxWidth = 1200, maxHeight = 1200, quality = 0.82) {
    if (!file || !file.type.startsWith('image/')) return null;
    if (file.type === 'image/gif') {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
    }

    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let w = img.width;
          let h = img.height;
          if (w > maxWidth || h > maxHeight) {
            const ratio = Math.min(maxWidth / w, maxHeight / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          const offCanvas = document.createElement('canvas');
          offCanvas.width = w;
          offCanvas.height = h;
          const offCtx = offCanvas.getContext('2d');
          offCtx.drawImage(img, 0, 0, w, h);
          let resDataUrl = null;
          try {
            const webpUrl = offCanvas.toDataURL('image/webp', quality);
            if (webpUrl && webpUrl.startsWith('data:image/webp')) {
              resDataUrl = webpUrl;
            }
          } catch (_) { }
          if (!resDataUrl) {
            resDataUrl = offCanvas.toDataURL('image/jpeg', quality);
          }
          resolve(resDataUrl);
        };
        img.onerror = () => resolve(e.target.result);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  // --- INICIALIZACIÓN ---
  function updateLobbyUserDisplay() {
    const currentName = (localStorage.getItem('vtt_username') || state.usuario?.nombre || '').trim();
    if (dom.lobbyUsernameInput) {
      if (document.activeElement !== dom.lobbyUsernameInput) {
        dom.lobbyUsernameInput.value = currentName;
      }
    }
    if (dom.lobbyUsernameStatus) {
      if (currentName) {
        dom.lobbyUsernameStatus.textContent = `✓ Jugador: ${currentName}`;
        dom.lobbyUsernameStatus.className = 'lobby-status-tag is-set';
      } else {
        dom.lobbyUsernameStatus.textContent = '⚠️ Escribe tu nombre antes de entrar';
        dom.lobbyUsernameStatus.className = 'lobby-status-tag is-warning';
      }
    }
    if (dom.lobbyUsernameDisplay) {
      dom.lobbyUsernameDisplay.textContent = currentName || 'Sin definir';
    }
  }

  function saveLobbyUsername(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) {
      if (dom.lobbyUsernameStatus) {
        dom.lobbyUsernameStatus.textContent = '⚠️ El nombre no puede estar vacío';
        dom.lobbyUsernameStatus.className = 'lobby-status-tag is-warning';
      }
      return false;
    }
    localStorage.setItem('vtt_username', trimmed);
    localStorage.setItem('vtt_username_explicit', '1');
    const deterministicId = 'usr_' + trimmed.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
    state.usuario.id = deterministicId;
    state.usuario.nombre = trimmed;
    localStorage.setItem('vtt_user_id', deterministicId);
    if (dom.joinUsernameInput) dom.joinUsernameInput.value = trimmed;
    const dmNameEl = document.getElementById('create-dm-name');
    if (dmNameEl && !dmNameEl.value.trim()) dmNameEl.value = trimmed;
    updateLobbyUserDisplay();
    return true;
  }

  function startApp() {
    try {
      // Purgar de inmediato blobs antiguos y pesados de localStorage para liberar espacio
      purgeLegacyLocalStorageMirrors();

      // Generar o cargar usuario id local basado en nombre de usuario si existe
      let savedUsername = localStorage.getItem('vtt_username');
      // Si el nombre guardado es el antiguo fallback 'Dungeon Master' y no fue elegido explícitamente, limpiarlo
      if (savedUsername === 'Dungeon Master' && !localStorage.getItem('vtt_username_explicit')) {
        savedUsername = null;
        localStorage.removeItem('vtt_username');
        localStorage.removeItem('vtt_user_id');
      }

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
      updateLobbyUserDisplay();
      loadGamesList();
      setupAutoSave();

      // Auto-reanudar sesión activa SOLO si estaba activamente en partida en esta pestaña
      const inSession = sessionStorage.getItem('vtt_in_session') === '1';
      const activeCode = localStorage.getItem('vtt_active_game_code');
      const activeUser = state.usuario.nombre || localStorage.getItem('vtt_username');
      if (inSession && activeCode && activeUser) {
        console.log('🔄 Reanudando automáticamente sesión activa:', activeCode);
        joinGameDirect(activeCode, activeUser);
      }

      // Soporte para unirse mediante parámetro URL (ej: /?codigo=ABC123 o /?code=ABC123)
      const urlParams = new URLSearchParams(window.location.search);
      const codeFromUrl = urlParams.get('codigo') || urlParams.get('code') || urlParams.get('partida');
      if (codeFromUrl) {
        const cleanUrlCode = codeFromUrl.toUpperCase().trim();
        if (activeUser) {
          joinGameDirect(cleanUrlCode, activeUser);
        } else {
          if (dom.joinCodeInput) dom.joinCodeInput.value = cleanUrlCode;
          openModal(dom.modalJoinGame);
          setTimeout(() => dom.joinUsernameInput?.focus(), 150);
        }
      }
    } catch (err) {
      console.error('❌ Error durante inicialización startApp():', err);
    }
  }

  // --- ELEMENTOS DOM ---
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
      lobbyUsernameInput: document.getElementById('lobby-username-input'),
      btnSaveLobbyUsername: document.getElementById('btn-save-lobby-username'),
      lobbyUsernameStatus: document.getElementById('lobby-username-status'),
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
      dmStagingBanner: document.getElementById('dm-staging-banner'),
      stagingViewingName: document.getElementById('staging-viewing-name'),
      stagingActiveName: document.getElementById('staging-active-name'),
      btnStagingActivateAll: document.getElementById('btn-staging-activate-all'),
      btnStagingReturnActive: document.getElementById('btn-staging-return-active'),

      // Herramientas DM
      toolButtons: document.querySelectorAll('.tool-btn'),
      toolOptionsContainer: document.getElementById('tool-options-container'),
      optDraw: document.getElementById('opt-draw'),
      optFigures: document.getElementById('opt-figures'),
      optProps: document.getElementById('opt-props'),
      toolProps: document.getElementById('tool-props'),
      drawColor: document.getElementById('draw-color'),
      drawSize: document.getElementById('draw-size'),
      btnClearDrawings: document.getElementById('btn-clear-drawings'),
      figType: document.getElementById('fig-type'),
      figSize: document.getElementById('fig-size'),
      figHeight: document.getElementById('fig-height'),
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
      btnReagruparFichas: document.getElementById('btn-reagrupar-fichas'),
      dmPlayersList: document.getElementById('dm-players-list'),
      newSceneName: document.getElementById('new-scene-name'),
      btnCreateScene: document.getElementById('btn-create-scene'),
      mapFileInput: document.getElementById('map-file-input'),
      btnClearMapBg: document.getElementById('btn-clear-map-bg'),
      gridColsInput: document.getElementById('grid-cols-input'),
      gridRowsInput: document.getElementById('grid-rows-input'),
      gridFeetInput: document.getElementById('grid-feet-input'),
      btnApplyGrid: document.getElementById('btn-apply-grid'),
      checkExperimentalProps: document.getElementById('check-experimental-props'),
      dmPropsSection: document.getElementById('dm-props-section'),
      propNameInput: document.getElementById('prop-name-input'),
      propUrlInput: document.getElementById('prop-url-input'),
      btnPropFileTrigger: document.getElementById('btn-prop-file-trigger'),
      propFileInput: document.getElementById('prop-file-input'),
      propWidthInput: document.getElementById('prop-width-input'),
      propHeightInput: document.getElementById('prop-height-input'),
      propRotInput: document.getElementById('prop-rot-input'),
      propLayerSelect: document.getElementById('prop-layer-select'),
      btnAddPropSubmit: document.getElementById('btn-add-prop-submit'),
      dmPropsList: document.getElementById('dm-props-list'),
      btnQuickGallery: document.getElementById('btn-quick-gallery'),
      btnOpenGalleryModal: document.getElementById('btn-open-gallery-modal'),
      modalDmGallery: document.getElementById('modal-dm-gallery'),
      dmGalleryCount: document.getElementById('dm-gallery-count'),
      modalGalleryCount: document.getElementById('modal-gallery-count'),
      selectFichaToTemplate: document.getElementById('select-ficha-to-template'),
      btnSaveCurrentTemplate: document.getElementById('btn-save-current-template'),
      dmGalleryList: document.getElementById('dm-gallery-list'),
      inputModalGallerySearch: document.getElementById('input-modal-gallery-search'),
      btnModalClearSearch: document.getElementById('btn-modal-clear-search'),
      dmGalleryModalGrid: document.getElementById('dm-gallery-modal-grid'),
      inputModalSpawnQty: document.getElementById('input-modal-spawn-qty'),
      inputDetailSpawnQty: document.getElementById('input-detail-spawn-qty'),
      btnQtyMinus: document.getElementById('btn-qty-minus'),
      btnQtyPlus: document.getElementById('btn-qty-plus'),

      modalTemplateDetail: document.getElementById('modal-template-detail'),
      btnSpawnFromDetail: document.getElementById('btn-spawn-from-detail'),
      templateDetailAvatar: document.getElementById('template-detail-avatar'),
      templateDetailName: document.getElementById('template-detail-name'),
      templateDetailType: document.getElementById('template-detail-type'),
      templateDetailSize: document.getElementById('template-detail-size'),
      templateDetailLevel: document.getElementById('template-detail-level'),
      templateDetailHp: document.getElementById('template-detail-hp'),
      templateDetailAc: document.getElementById('template-detail-ac'),
      templateDetailSpeed: document.getElementById('template-detail-speed'),
      templateDetailIni: document.getElementById('template-detail-ini'),
      templateDetailStr: document.getElementById('template-detail-str'),
      templateModStr: document.getElementById('template-mod-str'),
      templateDetailDex: document.getElementById('template-detail-dex'),
      templateModDex: document.getElementById('template-mod-dex'),
      templateDetailCon: document.getElementById('template-detail-con'),
      templateModCon: document.getElementById('template-mod-con'),
      templateDetailInt: document.getElementById('template-detail-int'),
      templateModInt: document.getElementById('template-mod-int'),
      templateDetailWis: document.getElementById('template-detail-wis'),
      templateModWis: document.getElementById('template-mod-wis'),
      templateDetailCha: document.getElementById('template-detail-cha'),
      templateModCha: document.getElementById('template-mod-cha'),
      templateDetailNotes: document.getElementById('template-detail-notes'),

      // Modales
      modalFicha: document.getElementById('modal-ficha'),
      formFicha: document.getElementById('form-ficha'),
      modalFichaTitle: document.getElementById('modal-ficha-title'),
      fichaImgFile: document.getElementById('ficha-img-file'),
      fichaImagenUrl: document.getElementById('ficha-imagen-url'),
      fichaImgPreview: document.getElementById('ficha-img-preview'),
      fichaJugadorId: document.getElementById('ficha-jugador-id'),
      groupFichaPropietario: document.getElementById('group-ficha-propietario'),

      modalGifView: document.getElementById('modal-gif-view'),
      enlargedGifImg: document.getElementById('enlarged-gif-img'),
      enlargedImgTitle: document.getElementById('enlarged-img-title'),
      enlargedImgNotas: document.getElementById('enlarged-img-notas'),

      modalRevelar: document.getElementById('modal-revelar-ficha'),
      revelarFichaId: document.getElementById('revelar-ficha-id'),
      revImagen: document.getElementById('rev-imagen'),
      revNombre: document.getElementById('rev-nombre'),
      revHpBar: document.getElementById('rev-hp-bar'),
      revHp: document.getElementById('rev-hp'),
      revAc: document.getElementById('rev-ac'),
      revNotas: document.getElementById('rev-notas'),
      revJugadoresSelect: document.getElementById('rev-jugadores-select'),
      btnRevOcultarTodo: document.getElementById('btn-rev-ocultar-todo'),
      btnRevRevelarTodo: document.getElementById('btn-rev-revelar-todo'),
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
      joinAvailableGamesList: document.getElementById('join-available-games-list'),
      modalEditGame: document.getElementById('modal-edit-game'),
      formEditGame: document.getElementById('form-edit-game'),
      editGameId: document.getElementById('edit-game-id'),
      editGameTitle: document.getElementById('edit-game-title'),
      editGameImgFile: document.getElementById('edit-game-img-file'),
      editGameImgUrl: document.getElementById('edit-game-img-url'),
      editGamePreviewImg: document.getElementById('edit-game-preview-img'),
      btnDmEditSession: document.getElementById('btn-dm-edit-session'),
      codeBadge: document.getElementById('code-badge'),
      modalChangeUser: document.getElementById('modal-change-user'),
      formChangeUser: document.getElementById('form-change-user'),
      inputChangeUsername: document.getElementById('input-change-username'),
      lobbyUsernameDisplay: document.getElementById('lobby-username-display'),
      btnLobbyChangeUser: document.getElementById('btn-lobby-change-user'),

      // Combat Tracker
      combatTrackerBar: document.getElementById('combat-tracker-bar'),
      combatRoundText: document.getElementById('combat-round-text'),
      combatActiveName: document.getElementById('combat-active-name'),
      combatTrackList: document.getElementById('combat-track-list'),
      btnCombatPrev: document.getElementById('btn-combat-prev'),
      btnCombatNext: document.getElementById('btn-combat-next'),
      btnCombatEnd: document.getElementById('btn-combat-end'),
      btnPlayerEndTurn: document.getElementById('btn-player-end-turn'),
      btnOpenCombatModal: document.getElementById('btn-open-combat-modal'),
      modalCombatSetup: document.getElementById('modal-combat-setup'),
      combatSetupTbody: document.getElementById('combat-setup-tbody'),
      combatSelectMaster: document.getElementById('combat-select-master'),
      btnCombatSelectAll: document.getElementById('btn-combat-select-all'),
      btnCombatRollAll: document.getElementById('btn-combat-roll-all'),
      btnCombatStartConfirm: document.getElementById('btn-combat-start-confirm'),
      btnCombatAddParticipant: document.getElementById('btn-combat-add-participant'),
      btnCombatAddConfirm: document.getElementById('btn-combat-add-confirm'),
      combatSetupTitleText: document.getElementById('combat-setup-title-text'),
      toolCombat: document.getElementById('tool-combat'),

      // Botones de Reclamar Rol DM
      btnReclamarDm: document.getElementById('btn-reclamar-dm'),
      btnQuickClaimDm: document.getElementById('btn-quick-claim-dm'),
      bannerPlayerClaimDm: document.getElementById('banner-player-claim-dm'),

      // Mobile Bottom Dock y Sheets
      mobileBottomDock: document.getElementById('mobile-bottom-dock'),
      mbBtnDice: document.getElementById('mb-btn-dice'),
      mbBtnMySheet: document.getElementById('mb-btn-my-sheet'),
      mbBtnCombat: document.getElementById('mb-btn-combat'),
      mbCombatText: document.getElementById('mb-combat-text'),
      mbCombatBadge: document.getElementById('mb-combat-badge'),
      mbBtnChat: document.getElementById('mb-btn-chat'),
      mbChatUnreadBadge: document.getElementById('mb-chat-unread-badge'),
      mbBtnZen: document.getElementById('mb-btn-zen'),
      mbBtnMenu: document.getElementById('mb-btn-menu'),
      btnRestoreZen: document.getElementById('btn-restore-zen'),
      mobileQuickDiceSheet: document.getElementById('mobile-quick-dice-sheet'),
      mbDiceBackdrop: document.getElementById('mb-dice-backdrop'),
      mbBtnCloseDice: document.getElementById('mb-btn-close-dice'),
      mbBtnRollD20: document.getElementById('mb-btn-roll-d20'),
      mbD20Subtext: document.getElementById('mb-d20-subtext'),
      mbModMinus: document.getElementById('mb-mod-minus'),
      mbModPlus: document.getElementById('mb-mod-plus'),
      mbModVal: document.getElementById('mb-mod-val'),
      mobileMySheetModal: document.getElementById('mobile-my-sheet-modal'),
      mbSheetBackdrop: document.getElementById('mb-sheet-backdrop'),
      mbBtnCloseMySheet: document.getElementById('mb-btn-close-my-sheet'),
      mbBtnOpenFullSheet: document.getElementById('mb-btn-open-full-sheet'),
      mbCharTitle: document.getElementById('mb-char-title'),
      mbCharBody: document.getElementById('mb-char-body'),

      // Mobile Token Action Bar
      mobileTokenActionBar: document.getElementById('mobile-token-action-bar'),
      mtTokenImg: document.getElementById('mt-token-img'),
      mtTokenName: document.getElementById('mt-token-name'),
      mtTokenHp: document.getElementById('mt-token-hp'),
      mtBtnClose: document.getElementById('mt-btn-close'),
      mtBtnTapMove: document.getElementById('mt-btn-tap-move'),
      mtTapMoveText: document.getElementById('mt-tap-move-text'),
      mtBtnQuickRoll: document.getElementById('mt-btn-quick-roll'),
      mtBtnEffects: document.getElementById('mt-btn-effects'),
      mtBtnEdit: document.getElementById('mt-btn-edit')
    };

    setupEventListeners();
    setupMobileMenuListeners();
    setupMobileDockAndSheetsListeners();
    setupMobileTokenActionBarListeners();
  }

  function closeAllPanels() {
    if (dom.rightPanel) dom.rightPanel.classList.remove('open');
    if (dom.dmToolsPanel) dom.dmToolsPanel.classList.remove('open');
    if (dom.mobileOverlay) dom.mobileOverlay.classList.remove('active');
    closeMobileBottomSheets();
  }

  let unreadChatCount = 0;
  let mobileDiceModifier = 0;
  let mobileDiceMode = 'normal'; // 'normal', 'ventaja', 'desventaja'
  let mobileTapToMoveActive = false;

  function closeMobileBottomSheets() {
    if (dom.mobileQuickDiceSheet) dom.mobileQuickDiceSheet.classList.add('hidden');
    if (dom.mobileMySheetModal) dom.mobileMySheetModal.classList.add('hidden');
    document.querySelectorAll('.mb-dock-btn').forEach(b => b.classList.remove('active'));
  }

  function openTabInRightPanel(tabId) {
    closeMobileBottomSheets();
    if (dom.rightPanel) dom.rightPanel.classList.add('open');
    if (dom.mobileOverlay) dom.mobileOverlay.classList.add('active');
    const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    if (targetBtn) {
      targetBtn.click();
    }
  }

  function getMyActiveFicha() {
    if (selectedFichasIds && selectedFichasIds.length > 0) {
      const sel = (state.fichas || []).find(f => f.id === selectedFichasIds[0]);
      if (sel && esDuenioDeFicha(sel)) return sel;
    }
    const uId = (state.usuario?.id || '').toLowerCase().trim();
    const uName = (state.usuario?.nombre || '').toLowerCase().trim();
    let mine = (state.fichas || []).find(f => {
      const fId = (f.jugador_id || '').toLowerCase().trim();
      return fId && (fId === uId || fId === uName || fId === 'usr_' + uName.replace(/[^a-z0-9]/g, '_'));
    });
    if (mine) return mine;
    mine = (state.fichas || []).find(f => f.nombre && f.nombre.toLowerCase().trim() === uName);
    if (mine) return mine;
    mine = (state.fichas || []).find(f => {
      const tipo = (f.tipo || '').toLowerCase().trim();
      return (!tipo || tipo === 'jugador' || tipo === 'pj' || tipo === 'personaje');
    });
    return mine || (state.fichas || [])[0] || null;
  }

  function renderMobileMySheet() {
    if (!dom.mbCharBody) return;
    const ficha = getMyActiveFicha();
    if (!ficha) {
      dom.mbCharBody.innerHTML = `
        <div style="text-align: center; padding: 20px 10px; color: #94a3b8;">
          <p style="margin-bottom: 12px; font-size: 0.9rem;">No tienes una ficha de personaje asignada todavía.</p>
          <button type="button" class="btn btn-gold btn-sm" id="mb-btn-create-ficha-prompt">
            <i class="fa-solid fa-plus"></i> Abrir Panel de Fichas
          </button>
        </div>
      `;
      document.getElementById('mb-btn-create-ficha-prompt')?.addEventListener('click', () => {
        closeMobileBottomSheets();
        openTabInRightPanel('tab-fichas');
      });
      return;
    }

    if (dom.mbCharTitle) {
      dom.mbCharTitle.innerHTML = `<i class="fa-solid fa-user-shield gold-text"></i> ${ficha.nombre || 'Mi Ficha'}`;
    }

    const hpActual = ficha.hp_actual ?? 10;
    const hpMax = Math.max(1, ficha.hp_maximo ?? 10);
    const hpPct = Math.max(0, Math.min(100, Math.round((hpActual / hpMax) * 100)));
    const avatarSrc = ficha.imagen || 'https://via.placeholder.com/60?text=PJ';
    const acVal = ficha.ac ?? 10;
    const speedVal = ficha.velocidad || 30;
    const destreza = ficha.destreza || 10;
    const dexMod = Math.floor((destreza - 10) / 2);
    const dexModStr = dexMod >= 0 ? `+${dexMod}` : `${dexMod}`;

    dom.mbCharBody.innerHTML = `
      <div class="mb-ficha-card">
        <div class="mb-ficha-top">
          <img src="${avatarSrc}" class="mb-ficha-avatar" alt="${ficha.nombre}">
          <div class="mb-ficha-meta">
            <div class="mb-ficha-name">${ficha.nombre}</div>
            <div class="mb-ficha-sub">${ficha.raza || 'Aventurero'} ${ficha.clase || ''} ${ficha.nivel ? 'Nv. ' + ficha.nivel : ''}</div>
          </div>
        </div>

        <div class="mb-hp-container">
          <div class="mb-hp-labels">
            <span>Puntos de Golpe (HP)</span>
            <span style="color: ${hpActual <= 0 ? '#ef4444' : '#22c55e'}">${hpActual} / ${hpMax}</span>
          </div>
          <div class="mb-hp-bar-bg">
            <div class="mb-hp-bar-fill" style="width: ${hpPct}%; background: ${hpPct < 25 ? '#ef4444' : (hpPct < 50 ? '#f59e0b' : '#22c55e')}"></div>
          </div>
          <div class="mb-hp-buttons">
            <button type="button" class="mb-hp-btn damage" data-delta="-5">-5 HP</button>
            <button type="button" class="mb-hp-btn damage" data-delta="-1">-1 HP</button>
            <button type="button" class="mb-hp-btn heal" data-delta="1">+1 HP</button>
            <button type="button" class="mb-hp-btn heal" data-delta="5">+5 HP</button>
          </div>
        </div>

        <div class="mb-stats-row">
          <div class="mb-stat-pill">
            <span>Armadura</span>
            <strong>🛡️ ${acVal}</strong>
          </div>
          <div class="mb-stat-pill">
            <span>Velocidad</span>
            <strong>👣 ${speedVal} ft</strong>
          </div>
          <div class="mb-stat-pill">
            <span>Iniciativa</span>
            <strong>⚡ ${dexModStr}</strong>
          </div>
        </div>
      </div>
    `;

    dom.mbCharBody.querySelectorAll('.mb-hp-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const delta = parseInt(btn.dataset.delta, 10);
        const nuevoHp = Math.max(0, Math.min(hpMax, hpActual + delta));
        ficha.hp_actual = nuevoHp;
        socket?.emit('modificar_hp', { fichaId: ficha.id, delta, nuevoHp });
        renderMobileMySheet();
        renderFichasList();
        markDirty();
        showToast(`${ficha.nombre}: ${delta > 0 ? '+' + delta : delta} HP (${nuevoHp}/${hpMax})`, delta > 0 ? 'gold' : 'error');
      });
    });
  }

  function setupMobileDockAndSheetsListeners() {
    [dom.mobileBottomDock, dom.mobileQuickDiceSheet, dom.mobileMySheetModal].forEach(el => {
      if (el) {
        el.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
        el.addEventListener('mousedown', (e) => e.stopPropagation());
      }
    });

    dom.mbBtnDice?.addEventListener('click', () => {
      const isHidden = dom.mobileQuickDiceSheet?.classList.contains('hidden');
      closeMobileBottomSheets();
      closeAllPanels();
      if (isHidden) {
        dom.mobileQuickDiceSheet?.classList.remove('hidden');
        dom.mbBtnDice?.classList.add('active');
      }
    });

    dom.mbDiceBackdrop?.addEventListener('click', closeMobileBottomSheets);
    dom.mbBtnCloseDice?.addEventListener('click', closeMobileBottomSheets);

    document.querySelectorAll('.mb-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mb-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        mobileDiceMode = btn.dataset.mode || 'normal';
        const label = mobileDiceMode.charAt(0).toUpperCase() + mobileDiceMode.slice(1);
        if (dom.mbD20Subtext) dom.mbD20Subtext.textContent = `(${label})`;
      });
    });

    dom.mbModMinus?.addEventListener('click', () => {
      mobileDiceModifier = Math.max(-10, mobileDiceModifier - 1);
      if (dom.mbModVal) dom.mbModVal.textContent = (mobileDiceModifier >= 0 ? '+' : '') + mobileDiceModifier;
    });

    dom.mbModPlus?.addEventListener('click', () => {
      mobileDiceModifier = Math.min(20, mobileDiceModifier + 1);
      if (dom.mbModVal) dom.mbModVal.textContent = (mobileDiceModifier >= 0 ? '+' : '') + mobileDiceModifier;
    });

    dom.mbBtnRollD20?.addEventListener('click', () => {
      let formula = '1d20';
      if (mobileDiceModifier !== 0) {
        formula += (mobileDiceModifier > 0 ? '+' : '') + mobileDiceModifier;
      }
      if (dom.diceFormulaInput) dom.diceFormulaInput.value = formula;
      const targetModeBtn = document.querySelector(`.btn-mode[data-mode="${mobileDiceMode}"]`);
      if (targetModeBtn) targetModeBtn.click();
      rollDice();
      closeMobileBottomSheets();
    });

    document.querySelectorAll('.mb-poly-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sides = btn.dataset.sides || '6';
        let formula = `1d${sides}`;
        if (mobileDiceModifier !== 0) {
          formula += (mobileDiceModifier > 0 ? '+' : '') + mobileDiceModifier;
        }
        if (dom.diceFormulaInput) dom.diceFormulaInput.value = formula;
        const normMode = document.querySelector('.btn-mode[data-mode="normal"]');
        if (normMode) normMode.click();
        rollDice();
        closeMobileBottomSheets();
      });
    });

    dom.mbBtnMySheet?.addEventListener('click', () => {
      const isHidden = dom.mobileMySheetModal?.classList.contains('hidden');
      closeMobileBottomSheets();
      closeAllPanels();
      if (isHidden) {
        renderMobileMySheet();
        dom.mobileMySheetModal?.classList.remove('hidden');
        dom.mbBtnMySheet?.classList.add('active');
      }
    });

    dom.mbSheetBackdrop?.addEventListener('click', closeMobileBottomSheets);
    dom.mbBtnCloseMySheet?.addEventListener('click', closeMobileBottomSheets);

    dom.mbBtnOpenFullSheet?.addEventListener('click', () => {
      const ficha = getMyActiveFicha();
      closeMobileBottomSheets();
      if (ficha) {
        abrirModalNotas();
      } else {
        openTabInRightPanel('tab-fichas');
      }
    });

    dom.mbBtnCombat?.addEventListener('click', () => {
      const combate = state.combate;
      closeMobileBottomSheets();
      if (combate && combate.activo) {
        const currentTurnIndex = combate.turnoIndex || 0;
        const activeParticipant = combate.participantes && combate.participantes[currentTurnIndex];
        const isMyTurn = activeParticipant && state.usuario?.id && (activeParticipant.jugador_id === state.usuario.id);

        if (isMyTurn) {
          if (confirm(`Es tu turno con ${activeParticipant.nombre}. ¿Deseas terminar tu turno?`)) {
            socket?.emit('siguiente_turno', { partidaId: state.partida.id });
            return;
          }
        } else if (state.usuario?.esDM) {
          socket?.emit('siguiente_turno', { partidaId: state.partida.id });
          showToast('Siguiente turno de combate (DM)', 'gold');
          return;
        }

        if (dom.combatTrackerBar) {
          dom.combatTrackerBar.classList.remove('hidden');
          dom.combatTrackerBar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          showToast(`Combate activo: Ronda ${combate.ronda || 1} • Turno: ${activeParticipant ? activeParticipant.nombre : ''}`, 'gold');
        }
      } else {
        if (state.usuario?.esDM) {
          openModal(dom.modalCombatSetup);
          cargarFichasParaCombate();
        } else {
          showToast('No hay ningún combate activo en este momento.', 'info');
        }
      }
    });

    dom.mbBtnChat?.addEventListener('click', () => {
      closeMobileBottomSheets();
      openTabInRightPanel('tab-chat');
    });

    dom.mbBtnZen?.addEventListener('click', () => {
      closeMobileBottomSheets();
      closeAllPanels();
      document.body.classList.add('zen-mode');
      if (dom.btnRestoreZen) dom.btnRestoreZen.classList.remove('hidden');
      showToast('👁️ Modo Zen activado. Pulsa el botón superior para restaurar.', 'info');
    });

    dom.btnRestoreZen?.addEventListener('click', () => {
      document.body.classList.remove('zen-mode');
      if (dom.btnRestoreZen) dom.btnRestoreZen.classList.add('hidden');
    });

    dom.mbBtnMenu?.addEventListener('click', () => {
      const isOpen = dom.rightPanel?.classList.contains('open');
      closeMobileBottomSheets();
      closeAllPanels();
      if (!isOpen && dom.rightPanel) {
        dom.rightPanel.classList.add('open');
        if (dom.mobileOverlay) dom.mobileOverlay.classList.add('active');
      }
    });
  }

  // --- ISLA FLOTANTE DE CONTROL DE TOKEN (MÓVIL) ---
  function showMobileTokenActionBar(ficha) {
    if (!ficha || !dom.mobileTokenActionBar) return;
    if (window.innerWidth > 900) return; // Solo en pantallas táctiles / móviles

    if (dom.mtTokenImg) dom.mtTokenImg.src = ficha.imagen || 'https://via.placeholder.com/40';
    if (dom.mtTokenName) dom.mtTokenName.textContent = ficha.nombre || 'Personaje';
    if (dom.mtTokenHp) dom.mtTokenHp.textContent = `${ficha.hp_actual ?? 10}/${ficha.hp_maximo ?? 10} HP`;

    mobileTapToMoveActive = false;
    if (dom.mtBtnTapMove) {
      dom.mtBtnTapMove.classList.remove('active-tap-move');
      if (dom.mtTapMoveText) dom.mtTapMoveText.textContent = 'Tocar para Mover';
    }

    dom.mobileTokenActionBar.classList.remove('hidden');
  }

  function hideMobileTokenActionBar() {
    if (dom.mobileTokenActionBar) dom.mobileTokenActionBar.classList.add('hidden');
    mobileTapToMoveActive = false;
    if (dom.mtBtnTapMove) {
      dom.mtBtnTapMove.classList.remove('active-tap-move');
      if (dom.mtTapMoveText) dom.mtTapMoveText.textContent = 'Tocar para Mover';
    }
  }

  function moveSelectedTokenByDelta(dx, dy) {
    if (!selectedFichasIds || selectedFichasIds.length === 0) return;
    const ficha = state.fichas.find(f => f.id === selectedFichasIds[0]);
    if (!ficha || (!state.usuario?.esDM && !esDuenioDeFicha(ficha))) return;
    ficha.x = Math.max(0, Math.round(ficha.x) + dx);
    ficha.y = Math.max(0, Math.round(ficha.y) + dy);
    const escCur = getEscenaActual();
    socket?.emit('guardar_posicion_ficha', {
      partidaId: state.partida.id,
      escenaId: escCur?.id,
      fichaId: ficha.id,
      x: ficha.x,
      y: ficha.y
    });
    markDirty();
    showToast(`📍 ${ficha.nombre} movido a (${ficha.x}, ${ficha.y})`, 'gold');
  }

  function setupMobileTokenActionBarListeners() {
    if (!dom.mobileTokenActionBar) return;

    dom.mobileTokenActionBar.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    dom.mobileTokenActionBar.addEventListener('mousedown', (e) => e.stopPropagation());

    dom.mtBtnClose?.addEventListener('click', () => {
      selectedFichasIds = [];
      hideMobileTokenActionBar();
      markDirty();
    });

    // Modo tocar casilla para mover
    dom.mtBtnTapMove?.addEventListener('click', () => {
      mobileTapToMoveActive = !mobileTapToMoveActive;
      if (mobileTapToMoveActive) {
        dom.mtBtnTapMove.classList.add('active-tap-move');
        if (dom.mtTapMoveText) dom.mtTapMoveText.textContent = 'Toca una casilla';
        showToast('📍 Toca la casilla del mapa donde quieres colocar la ficha', 'gold');
      } else {
        dom.mtBtnTapMove.classList.remove('active-tap-move');
        if (dom.mtTapMoveText) dom.mtTapMoveText.textContent = 'Tocar para Mover';
      }
    });

    // D-Pad flechas de movimiento
    document.querySelectorAll('.mt-dpad-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dir = btn.dataset.dir;
        if (dir === 'up') moveSelectedTokenByDelta(0, -1);
        else if (dir === 'down') moveSelectedTokenByDelta(0, 1);
        else if (dir === 'left') moveSelectedTokenByDelta(-1, 0);
        else if (dir === 'right') moveSelectedTokenByDelta(1, 0);
      });
    });

    // Modificadores rápidos de HP (-5, -1, +1, +5)
    document.querySelectorAll('.mt-hp-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!selectedFichasIds || selectedFichasIds.length === 0) return;
        const ficha = state.fichas.find(f => f.id === selectedFichasIds[0]);
        if (!ficha || (!state.usuario?.esDM && !esDuenioDeFicha(ficha))) return;
        const delta = parseInt(btn.dataset.delta, 10);
        const hpMax = Math.max(1, ficha.hp_maximo ?? 10);
        const nuevoHp = Math.max(0, Math.min(hpMax, (ficha.hp_actual ?? 10) + delta));
        ficha.hp_actual = nuevoHp;
        socket?.emit('modificar_hp', { fichaId: ficha.id, delta, nuevoHp });
        if (dom.mtTokenHp) dom.mtTokenHp.textContent = `${nuevoHp}/${hpMax} HP`;
        renderFichasList();
        markDirty();
        showToast(`${ficha.nombre}: ${delta > 0 ? '+' + delta : delta} HP (${nuevoHp}/${hpMax})`, delta > 0 ? 'gold' : 'error');
      });
    });

    // Tirar d20 con esta ficha
    dom.mtBtnQuickRoll?.addEventListener('click', () => {
      if (selectedFichasIds && selectedFichasIds[0] && dom.diceTokenSelect) {
        dom.diceTokenSelect.value = selectedFichasIds[0];
      }
      if (dom.mobileQuickDiceSheet) {
        dom.mobileQuickDiceSheet.classList.remove('hidden');
        if (dom.mbBtnDice) dom.mbBtnDice.classList.add('active');
      }
    });

    // Abrir modal de estados y efectos [ALPHA]
    dom.mtBtnEffects?.addEventListener('click', () => {
      if (selectedFichasIds && selectedFichasIds[0]) {
        openModalFichaEfectos(selectedFichasIds[0]);
      }
    });

    // Ver / Editar ficha
    dom.mtBtnEdit?.addEventListener('click', () => {
      if (selectedFichasIds && selectedFichasIds[0]) {
        const ficha = state.fichas.find(f => f.id === selectedFichasIds[0]);
        if (ficha) {
          abrirModalNotas();
        }
      }
    });
  }

  function setupMobileMenuListeners() {
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
      dom.mobileOverlay.addEventListener('touchstart', (e) => {
        if (e.cancelable) e.preventDefault();
        closeAllPanels();
      }, { passive: false });
    }

    // Gestos táctiles de deslizamiento (Swipe) para cerrar paneles laterales en móviles
    function setupSwipeToClose(element, direction) {
      if (!element) return;
      let startX = 0;
      let startY = 0;
      element.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
          startX = e.touches[0].clientX;
          startY = e.touches[0].clientY;
        }
      }, { passive: true });

      element.addEventListener('touchend', (e) => {
        if (e.changedTouches.length === 1) {
          const deltaX = e.changedTouches[0].clientX - startX;
          const deltaY = e.changedTouches[0].clientY - startY;
          if (Math.abs(deltaY) < 90) {
            if (direction === 'right' && deltaX > 50) {
              closeAllPanels();
            } else if (direction === 'left' && deltaX < -50) {
              closeAllPanels();
            }
          }
        }
      }, { passive: true });
    }

    setupSwipeToClose(dom.rightPanel, 'right');
    setupSwipeToClose(dom.dmToolsPanel, 'left');

    // Botones de cierre explícito (X) dentro de paneles laterales en móviles
    document.querySelectorAll('.btn-close-panel').forEach(btn => {
      btn.addEventListener('click', closeAllPanels);
    });

    // Prevenir que toques en controles flotantes traspasen al canvas subyacente
    const controlsEl = document.querySelector('.canvas-controls');
    if (controlsEl) {
      controlsEl.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
      controlsEl.addEventListener('touchend', (e) => e.stopPropagation(), { passive: true });
    }
  }

  function esDuenioDeFicha(ficha) {
    if (!ficha) return false;
    if (state.usuario?.esDM) return true;

    const uId = (state.usuario?.id || '').toLowerCase().trim();
    const uName = (state.usuario?.nombre || '').toLowerCase().trim();
    const fJugadorId = (ficha.jugador_id || '').toLowerCase().trim();

    if (fJugadorId && (fJugadorId === uId || fJugadorId === uName || fJugadorId === 'usr_' + uName.replace(/[^a-z0-9]/g, '_'))) return true;

    // Si el nombre de la ficha coincide con el nombre de usuario del jugador conectado
    if (ficha.nombre && ficha.nombre.toLowerCase().trim() === uName) return true;

    // Si la ficha es un PJ (tipo jugador / pj / personaje) y no tiene dueño asignado, cualquier jugador puede controlarla/reclamarla
    const tipoLower = (ficha.tipo || '').toLowerCase().trim();
    const esPJ = !tipoLower || tipoLower === 'jugador' || tipoLower === 'pj' || tipoLower === 'personaje';
    if (!fJugadorId && esPJ) {
      return true;
    }

    return false;
  }

  function populateFichaOwnerSelect(currentOwnerId) {
    const select = dom.fichaJugadorId || document.getElementById('ficha-jugador-id');
    const group = dom.groupFichaPropietario || document.getElementById('group-ficha-propietario');
    if (!select || !group) return;

    if (!state.usuario?.esDM) {
      group.style.display = 'none';
      return;
    }

    group.style.display = '';
    select.innerHTML = '<option value="">-- Sin asignar (Solo DM) --</option>';

    const playersMap = new Map();
    (state.jugadoresConectados || []).forEach(j => {
      if (j && j.id && !j.esDM) {
        playersMap.set(j.id, j.nombre || j.id);
      }
    });

    (state.fichas || []).forEach(f => {
      if (f && f.jugador_id && !playersMap.has(f.jugador_id)) {
        playersMap.set(f.jugador_id, f.jugador_id);
      }
    });

    playersMap.forEach((pName, pId) => {
      const opt = document.createElement('option');
      opt.value = pId;
      opt.textContent = `${pName} (${pId})`;
      select.appendChild(opt);
    });

    select.value = currentOwnerId || '';
  }

  function getFichaVisibility(ficha) {
    if (state.usuario.esDM || ficha.tipo === 'jugador') {
      return { imagen: true, nombre: true, hp: true, barra_hp: true, ac: true, notas: true };
    }

    let config;
    try {
      config = JSON.parse(ficha.revelado);
    } catch (e) {
      const isRevealed = ficha.revelado === 1 || ficha.revelado === '1' || ficha.revelado === true;
      config = { global: { imagen: isRevealed, nombre: isRevealed, hp: isRevealed, barra_hp: isRevealed, ac: isRevealed, notas: isRevealed }, jugadores: {} };
    }

    if (!config || !config.global) {
      config = { global: { imagen: false, nombre: false, hp: false, barra_hp: false, ac: false, notas: false }, jugadores: {} };
    }

    const userId = state.usuario.id;
    const userConfig = config.jugadores?.[userId];

    const globalHp = config.global.hp;
    const globalBarraHp = config.global.barra_hp !== undefined ? config.global.barra_hp : globalHp;

    const userHp = userConfig?.hp;
    const userBarraHp = userConfig?.barra_hp !== undefined ? userConfig.barra_hp : (userHp !== undefined ? userHp : globalBarraHp);

    return {
      imagen: userConfig?.imagen ?? config.global.imagen,
      nombre: userConfig?.nombre ?? config.global.nombre,
      hp: userHp ?? globalHp,
      barra_hp: userBarraHp,
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
      timeout: 30000
    });

    // Helper: emite cuando el socket esté conectado
    window._emitWhenReady = function (event, data) {
      if (!socket) { initSocket(); }
      if (socket && !socket.connected) {
        try { socket.connect(); } catch (_) { }
      }
      if (socket && socket.connected) {
        socket.emit(event, data);
      } else if (socket) {
        socket.once('connect', () => socket.emit(event, data));
      }
    };

    // Reconexión y Estado de Conexión
    socket.on('connect', () => {
      if (dom.reconnectBanner) dom.reconnectBanner.classList.add('hidden');
      showSaveIndicator('🟢 Conectado');

      const isVttActive = dom.screenVTT && !dom.screenVTT.classList.contains('hidden');
      const activeCode = state.partida?.codigo || localStorage.getItem('vtt_active_game_code');
      if (isVttActive && activeCode && state.usuario.nombre) {
        socket.emit('unirse_partida', {
          codigo: activeCode,
          nombreUsuario: state.usuario.nombre,
          usuarioId: state.usuario.id
        });
      }
    });

    socket.on('disconnect', (reason) => {
      console.warn('⚠️ Desconectado del host:', reason);
      if (isDraggingToken || isDraggingFigure) {
        isDraggingToken = false;
        isDraggingFigure = false;
        selectedFichasIds = [];
        dragOffsets = {};
        markDirty();
      }
      if (dom.reconnectBanner) {
        dom.reconnectBanner.classList.remove('hidden');
        if (dom.reconnectMsg) {
          dom.reconnectMsg.textContent = 'Conexión interrumpida (' + reason + '). Reconectando automáticamente...';
        }
      }
      showSaveIndicator('🔴 Desconectado');
    });

    socket.on('connect_error', () => {
      if (isDraggingToken || isDraggingFigure) {
        isDraggingToken = false;
        isDraggingFigure = false;
        selectedFichasIds = [];
        dragOffsets = {};
        markDirty();
      }
      if (dom.reconnectBanner) {
        dom.reconnectBanner.classList.remove('hidden');
        if (dom.reconnectMsg) {
          dom.reconnectMsg.textContent = 'Problema de red o servidor no disponible. Reintentando...';
        }
      }
      showSaveIndicator('🔴 Reconectando...');
    });

    window.addEventListener('blur', () => {
      if (isDraggingToken || isDraggingFigure) {
        isDraggingToken = false;
        isDraggingFigure = false;
        selectedFichasIds = [];
        dragOffsets = {};
        markDirty();
      }
    });

    socket.on('partida_eliminada', (data) => {
      alert(data?.mensaje || 'La partida ha sido eliminada.');
      window.location.href = '/';
    });

    socket.on('partida_restaurada', (data) => {
      showToast('🔄 ' + (data?.mensaje || 'Partida cargada a una versión previa.'), 'info');
      if (data && data.partida && data.escenaActiva) {
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
        saveLocalMirrorBackup();
        if (state.usuario?.esDM) {
          loadDmBackupsList();
        }
        showScreen('vtt');
        updateUIForCurrentGame();
        if (state.escenaActiva && state.escenaActiva.mapa) {
          loadMapImage(state.escenaActiva.mapa);
        } else {
          loadMapImage(null);
        }
        markDirty();
      } else if (state.partida?.codigo) {
        socket.emit('unirse_partida', {
          codigo: state.partida.codigo,
          nombreUsuario: state.usuario.nombre,
          usuarioId: state.usuario.id
        });
      }
    });

    socket.on('estado_inicial', (data) => {
      hideVttLoading();
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
      state.props = data.props || [];
      state.combate = data.combate || { activo: false, ronda: 1, turnoIndex: 0, participantes: [] };
      state.jugadoresConectados = data.jugadoresConectados || [];
      state.usuario = data.usuario;

      if (data.partida?.efectos_catalogo) {
        try {
          state.customEffectsCatalog = typeof data.partida.efectos_catalogo === 'string'
            ? JSON.parse(data.partida.efectos_catalogo)
            : data.partida.efectos_catalogo;
        } catch (_) { state.customEffectsCatalog = []; }
      } else {
        state.customEffectsCatalog = [];
      }

      // Cargar preferencia experimental de capas
      const expSaved = localStorage.getItem('vtt_exp_props_' + (data.partida?.codigo || ''));
      state.experimentalPropsEnabled = expSaved === 'true';
      if (dom.checkExperimentalProps) dom.checkExperimentalProps.checked = state.experimentalPropsEnabled;
      toggleExperimentalPropsUI(state.experimentalPropsEnabled);

      // Guardar partida activa en almacenamiento local para no perder contexto ante F5 o recargas
      if (state.partida && state.partida.codigo) {
        localStorage.setItem('vtt_active_game_code', state.partida.codigo);
        localStorage.setItem('vtt_active_game_id', state.partida.id);
      }
      saveLocalMirrorBackup();
      if (state.usuario?.esDM) {
        loadDmBackupsList();
      }

      showScreen('vtt');
      updateUIForCurrentGame();
      renderCombatTracker();
      renderPropsList();
      if (state.escenaActiva && state.escenaActiva.mapa) {
        loadMapImage(state.escenaActiva.mapa);
      } else {
        loadMapImage(null);
      }
      markDirty();
    });

    socket.on('combate_actualizado', (combate) => {
      const combateAnterior = state.combate;
      state.combate = combate || { activo: false, ronda: 1, turnoIndex: 0, participantes: [] };
      renderCombatTracker();
      renderFichasList();
      markDirty();

      // Notificación si el turno pasó al jugador actual
      if (state.combate.activo && state.combate.participantes && state.combate.participantes.length > 0) {
        const turnoActual = state.combate.participantes[state.combate.turnoIndex];
        const cambioDeTurno = !combateAnterior || !combateAnterior.activo || combateAnterior.turnoIndex !== state.combate.turnoIndex || combateAnterior.ronda !== state.combate.ronda;
        if (turnoActual && cambioDeTurno && state.usuario?.id && (turnoActual.jugador_id === state.usuario.id)) {
          showToast(`⚔️ ¡Es tu turno de actuar con ${turnoActual.nombre}!`, 'gold');
        }
      }
    });

    socket.on('error_partida', (msg) => {
      hideVttLoading();
      localStorage.removeItem('vtt_active_game_code');
      sessionStorage.removeItem('vtt_in_session');
      showScreen('start');
      alert('❌ Error: ' + msg);
    });

    socket.on('escena_cambiada', ({ escenaActiva, figuras, dibujos, posiciones_fichas, props }) => {
      if (!state.escenaActiva || state.escenaActiva.id !== escenaActiva?.id) {
        viewportInitializedForScene = null;
      }
      state.escenaActiva = escenaActiva;
      state.escenaPreparacion = null; // Al activarse, volvemos a la escena activa
      state.figuras = figuras || [];
      state.dibujos = dibujos || [];
      state.props = props || [];
      if (dom.currentSceneName) dom.currentSceneName.textContent = escenaActiva.nombre;
      if (dom.gridColsInput) dom.gridColsInput.value = escenaActiva.config_grid_x || 40;
      if (dom.gridRowsInput) dom.gridRowsInput.value = escenaActiva.config_grid_y || 40;
      if (dom.gridFeetInput) dom.gridFeetInput.value = escenaActiva.config_casilla || 5;

      const cols = escenaActiva.config_grid_x || 40;
      const rows = escenaActiva.config_grid_y || 40;
      const posMap = new Map((posiciones_fichas || []).map(p => [p.ficha_id, p]));

      let playerIdx = 0;
      state.fichas.forEach(f => {
        const pos = posMap.get(f.id);
        const tipoLower = (f.tipo || '').toLowerCase().trim();
        const esJugador = !tipoLower || tipoLower === 'jugador' || tipoLower === 'personaje' || tipoLower === 'pj';

        if (pos) {
          if (pos.x < 0 || pos.x >= cols || pos.y < 0 || pos.y >= rows) {
            f.x = Math.max(1, Math.min(cols - 2, 2 + (playerIdx % 4)));
            f.y = Math.max(1, Math.min(rows - 2, 2 + Math.floor(playerIdx / 4)));
            playerIdx++;
          } else {
            f.x = pos.x;
            f.y = pos.y;
          }
        } else if (esJugador) {
          // Si el jugador no tenía posición en la nueva escena, ubicarlo ordenadamente al inicio dentro del mapa
          f.x = Math.max(1, Math.min(cols - 2, 2 + (playerIdx % 4)));
          f.y = Math.max(1, Math.min(rows - 2, 2 + Math.floor(playerIdx / 4)));
          playerIdx++;
        }
      });

      loadMapImage(escenaActiva.mapa);
      updateStagingBanner();
      renderFichasList();
      renderTokenSelects();
      renderScenesList();
      renderPropsList();
      markDirty();
    });

    // DM recibe la escena que está preparando/editando en privado
    socket.on('dm_escena_cargada', ({ escena, figuras, dibujos, posiciones_fichas, props }) => {
      const esRetornoActiva = Boolean(state.escenaActiva && escena.id === state.escenaActiva.id);
      if (esRetornoActiva) {
        state.escenaPreparacion = null;
        state.escenaActiva = escena;
      } else {
        state.escenaPreparacion = escena;
      }

      state.figuras = figuras || [];
      state.dibujos = dibujos || [];
      state.props = props || [];

      if (dom.gridColsInput) dom.gridColsInput.value = escena.config_grid_x || 40;
      if (dom.gridRowsInput) dom.gridRowsInput.value = escena.config_grid_y || 40;
      if (dom.gridFeetInput) dom.gridFeetInput.value = escena.config_casilla || 5;

      const cols = escena.config_grid_x || 40;
      const rows = escena.config_grid_y || 40;
      const posMap = new Map((posiciones_fichas || []).map(p => [p.ficha_id, p]));

      let playerIdx = 0;
      state.fichas.forEach(f => {
        const pos = posMap.get(f.id);
        const tipoLower = (f.tipo || '').toLowerCase().trim();
        const esJugador = !tipoLower || tipoLower === 'jugador' || tipoLower === 'personaje' || tipoLower === 'pj';

        if (pos) {
          if (pos.x < 0 || pos.x >= cols || pos.y < 0 || pos.y >= rows) {
            f.x = Math.max(1, Math.min(cols - 2, 2 + (playerIdx % 4)));
            f.y = Math.max(1, Math.min(rows - 2, 2 + Math.floor(playerIdx / 4)));
            playerIdx++;
          } else {
            f.x = pos.x;
            f.y = pos.y;
          }
        } else if (esJugador) {
          f.x = Math.max(1, Math.min(cols - 2, 2 + (playerIdx % 4)));
          f.y = Math.max(1, Math.min(rows - 2, 2 + Math.floor(playerIdx / 4)));
          playerIdx++;
        }
      });

      viewportInitializedForScene = null;
      loadMapImage(escena.mapa);
      centerMap();
      updateStagingBanner();
      renderScenesList();
      renderPropsList();
      renderFichasList();
      markDirty();
      if (esRetornoActiva) {
        showToast(`Volviste a la escena activa: ${escena.nombre}`, 'info');
      } else {
        showToast(`👁️ Preparando escena: ${escena.nombre}`, 'info');
      }
    });

    // Fichas reagrupadas en la escena
    socket.on('fichas_reagrupadas', ({ escenaId, fichas }) => {
      const escCur = getEscenaActual();
      if (escCur && escCur.id === escenaId) {
        (fichas || []).forEach(pos => {
          const f = (state.fichas || []).find(fi => fi.id === pos.fichaId);
          if (f) {
            f.x = pos.x;
            f.y = pos.y;
          }
        });
        showToast('📍 Fichas de jugadores reagrupadas en la escena', 'gold');
        renderFichasList();
        markDirty();
      }
    });

    // Eventos de Capas / Utilería (Props)
    socket.on('prop_actualizado', ({ escenaId, prop }) => {
      const escCur = getEscenaActual();
      if (escCur && escCur.id === escenaId) {
        const idx = (state.props || []).findIndex(p => p.id === prop.id);
        if (idx !== -1) {
          state.props[idx] = prop;
        } else {
          state.props.push(prop);
        }
        renderPropsList();
        markDirty();
      }
    });

    socket.on('prop_movido', ({ escenaId, propId, x, y }) => {
      const escCur = getEscenaActual();
      if (escCur && escCur.id === escenaId) {
        const prop = (state.props || []).find(p => p.id === propId);
        if (prop) {
          prop.x = x;
          prop.y = y;
          markDirty();
        }
      }
    });

    socket.on('prop_eliminado', ({ escenaId, propId }) => {
      const escCur = getEscenaActual();
      if (escCur && escCur.id === escenaId) {
        state.props = (state.props || []).filter(p => p.id !== propId);
        if (selectedPropId === propId) selectedPropId = null;
        renderPropsList();
        markDirty();
      }
    });

    socket.on('partida_actualizada', ({ id, nombre, imagen_portada }) => {
      if (state.partida && state.partida.id === id) {
        state.partida.nombre = nombre;
        state.partida.imagen_portada = imagen_portada;
        if (dom.navGameTitle) dom.navGameTitle.textContent = nombre;
        document.title = `${nombre} - VTT D&D 5e`;
      }
      loadGamesList();
    });

    socket.on('escenas_actualizadas', (escenas) => {
      state.escenas = escenas || [];
      renderScenesList();
    });

    socket.on('mapa_actualizado', ({ escenaId, mapa }) => {
      const esc = (state.escenas || []).find(e => e.id === escenaId);
      if (esc) esc.mapa = mapa;
      if (state.escenaActiva?.id === escenaId) state.escenaActiva.mapa = mapa;
      if (state.escenaPreparacion?.id === escenaId) state.escenaPreparacion.mapa = mapa;

      const escCur = getEscenaActual();
      if (escCur && escCur.id === escenaId) {
        loadMapImage(mapa);
        markDirty();
      }
    });

    socket.on('grid_actualizado', ({ escenaId, gridX, gridY, casilla }) => {
      const esc = (state.escenas || []).find(e => e.id === escenaId);
      if (esc) {
        esc.config_grid_x = gridX;
        esc.config_grid_y = gridY;
        esc.config_casilla = casilla;
      }
      if (state.escenaActiva?.id === escenaId) {
        state.escenaActiva.config_grid_x = gridX;
        state.escenaActiva.config_grid_y = gridY;
        state.escenaActiva.config_casilla = casilla;
        if (state.partida) {
          state.partida.config_grid_x = gridX;
          state.partida.config_grid_y = gridY;
          state.partida.config_casilla = casilla;
        }
      }
      if (state.escenaPreparacion?.id === escenaId) {
        state.escenaPreparacion.config_grid_x = gridX;
        state.escenaPreparacion.config_grid_y = gridY;
        state.escenaPreparacion.config_casilla = casilla;
      }
      const escCur = getEscenaActual();
      if (escCur && escCur.id === escenaId) {
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
        updateDiceEffectsBanner();
        if (currentEditingFichaEffectsId === fichaActualizada.id) {
          renderActiveFichaEffectsModal(fichaActualizada);
        }
        markDirty();
        debounceLocalMirrorSave();
      }
    });

    socket.on('catalogo_efectos_actualizado', (catalogo) => {
      state.customEffectsCatalog = Array.isArray(catalogo) ? catalogo : [];
      renderCustomEffectsSavedList();
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

    socket.on('usuario_actualizado', (user) => {
      if (user && user.id) {
        state.usuario = { ...state.usuario, ...user };
        localStorage.setItem('vtt_username', user.nombre);
        localStorage.setItem('vtt_username_explicit', '1');
        localStorage.setItem('vtt_user_id', user.id);
        updateUIForCurrentGame();
        updateLobbyUserDisplay();
      }
    });

    // Lista de jugadores conectados (para menú de visibilidad)
    socket.on('lista_jugadores', (jugadores) => {
      state.jugadoresConectados = jugadores || [];
      renderDmPlayersList();
    });

    socket.on('dibujos_actualizados', (dibujos) => {
      state.dibujos = dibujos || [];
      markDirty();
      debounceLocalMirrorSave();
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
      const chatPane = document.getElementById('tab-chat');
      const isChatVisible = chatPane && chatPane.classList.contains('active') && dom.rightPanel?.classList.contains('open');
      if (!isChatVisible) {
        unreadChatCount++;
        if (dom.mbChatUnreadBadge) {
          dom.mbChatUnreadBadge.textContent = unreadChatCount > 9 ? '9+' : unreadChatCount;
          dom.mbChatUnreadBadge.classList.remove('hidden');
        }
      }
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
      markDirty();
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
  let cachedCanvasRect = null;
  function updateCanvasRect() {
    if (canvas) cachedCanvasRect = canvas.getBoundingClientRect();
  }

  function markDirty() {
    isDirty = true;
    if (!rafScheduled) {
      rafScheduled = true;
      requestAnimationFrame(rafRender);
    }
  }

  let lastCombatPulseTime = 0;
  function rafRender(timestamp) {
    rafScheduled = false;
    const shouldAnimateCombat = state.combate && state.combate.activo && state.combate.participantes && state.combate.participantes.length > 0;
    if (activeDiceAnimations.length > 0) {
      const now = Date.now();
      activeDiceAnimations = activeDiceAnimations.filter(a => now - a.startTime < 2500);
    }
    const hasDiceAnim = activeDiceAnimations.length > 0;

    let shouldRender = isDirty;
    if (!shouldRender && hasDiceAnim) {
      shouldRender = true;
    }
    if (!shouldRender && shouldAnimateCombat) {
      // Pulso suave de combate en reposo a ~25 FPS para no saturar la CPU
      const now = timestamp || Date.now();
      if (now - lastCombatPulseTime >= 40) {
        lastCombatPulseTime = now;
        shouldRender = true;
      }
    }

    if (shouldRender) {
      isDirty = false;
      renderCanvas();
    }

    if (shouldAnimateCombat || hasDiceAnim) {
      rafScheduled = true;
      requestAnimationFrame(rafRender);
    }
  }

  function initCanvas() {
    canvas = dom.canvas;
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    resizeCanvas();

    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', () => {
      setTimeout(resizeCanvas, 150);
      setTimeout(resizeCanvas, 350);
    });
    window.addEventListener('scroll', updateCanvasRect, { passive: true });

    // Eventos de Mouse
    dom.canvasContainer?.addEventListener('mousedown', handleMouseDown);
    dom.canvasContainer?.addEventListener('mousemove', handleMouseMove);
    dom.canvasContainer?.addEventListener('mouseup', handleMouseUp);
    dom.canvasContainer?.addEventListener('mouseleave', handleMouseUp);
    dom.canvasContainer?.addEventListener('wheel', handleWheel, { passive: false });

    // Asegurar que el canvas y el contenedor wrapper capturen el wheel también
    if (dom.canvasWrapper) {
      dom.canvasWrapper.addEventListener('wheel', handleWheel, { passive: false });
    }
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    // Eventos Táctiles Móvil (Touch)
    dom.canvasContainer?.addEventListener('touchstart', handleTouchStart, { passive: false });
    dom.canvasContainer?.addEventListener('touchmove', handleTouchMove, { passive: false });
    dom.canvasContainer?.addEventListener('touchend', handleTouchEnd, { passive: false });
    dom.canvasContainer?.addEventListener('touchcancel', handleTouchCancel, { passive: false });
  }

  function resizeCanvas() {
    if (!dom.canvasWrapper || !canvas) return;
    canvas.width = dom.canvasWrapper.clientWidth;
    canvas.height = dom.canvasWrapper.clientHeight;
    updateCanvasRect();
    markDirty();
  }

  // Centra el viewport en el centro del mapa
  function centerMap() {
    if (!canvas) return;
    const escCur = getEscenaActual();
    const cols = escCur?.config_grid_x || state.partida?.config_grid_x || 40;
    const rows = escCur?.config_grid_y || state.partida?.config_grid_y || 40;
    const mapWidth = cols * viewport.tileSize;
    const mapHeight = rows * viewport.tileSize;
    viewport.panX = (canvas.width - mapWidth * viewport.zoom) / 2;
    viewport.panY = (canvas.height - mapHeight * viewport.zoom) / 2;
  }

  function loadMapImage(src) {
    const escCur = getEscenaActual();
    if (!src) {
      // Si la escena visible actual ya tiene mapa en memoria, preservarlo
      if (escCur && escCur.mapa) {
        src = escCur.mapa;
      } else {
        mapImageLoaded = false;
        mapImage = null;
        if (dom.mapBgImg) {
          dom.mapBgImg.src = '';
          dom.mapBgImg.classList.add('hidden');
        }
        markDirty();
        return;
      }
    }

    // Si ya está exactamente la misma imagen cargada en memoria, evitar parpadeos
    if (mapImage && (mapImage.src === src || (src && mapImage.src.endsWith(src))) && mapImageLoaded) {
      markDirty();
      return;
    }

    const img = new Image();
    img.onload = () => {
      // Si la imagen devuelta es el pixel vacío de contingencia (<= 1x1), tratar como sin mapa
      if (img.naturalWidth <= 1 && img.naturalHeight <= 1) {
        mapImage = null;
        mapImageLoaded = false;
        if (dom.mapBgImg) {
          dom.mapBgImg.classList.add('hidden');
          dom.mapBgImg.src = '';
        }
        markDirty();
        return;
      }

      mapImage = img;
      mapImageLoaded = true;

      const isGif = typeof src === 'string' && (src.startsWith('data:image/gif') || src.toLowerCase().includes('.gif'));
      if (isGif) {
        if (dom.mapBgImg) {
          dom.mapBgImg.src = src;
          dom.mapBgImg.classList.remove('hidden');
        }
        mapImage = null; // Don't render with canvas if it's a GIF
      } else {
        if (dom.mapBgImg) {
          dom.mapBgImg.classList.add('hidden');
          dom.mapBgImg.src = '';
        }
      }

      if (viewportInitializedForScene !== escCur?.id) {
        if (!isPanning) centerMap(); // Centrar una sola vez al entrar por primera vez a la escena
        viewportInitializedForScene = escCur?.id;
      }
      markDirty();
    };
    img.onerror = () => {
      console.warn('[VTT] No se pudo cargar imagen de mapa desde:', src);
      if (!mapImage) {
        mapImage = null;
        mapImageLoaded = false;
        markDirty();
      }
      if (state.usuario?.esDM && !img._warned) {
        img._warned = true;
        showToast('🗺️ Imagen de mapa no encontrada en el servidor. Puedes subir una nueva desde el panel de Escenas.', 'warning');
      }
    };
    img.src = src;
  }

  function getTileSize() {
    return viewport.tileSize * viewport.zoom;
  }

  // Transforma coordenadas de pantalla a casillas del grid (con caché de rect para evitar Layout Thrashing)
  function screenToGrid(screenX, screenY) {
    const rect = cachedCanvasRect || (canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0 });
    const tileSize = getTileSize();
    const x = (screenX - rect.left - viewport.panX) / tileSize;
    const y = (screenY - rect.top - viewport.panY) / tileSize;
    return { x, y };
  }

  // Multiplicador de escala según el tamaño base de la criatura / ficha (D&D 5e)
  function getFichaScaleMult(ficha) {
    if (!ficha) return 1;
    let scaleMult = 1;
    const t = String(ficha.tamanio_base || 'mediano').toLowerCase().trim();
    if (t === 'tiny' || t === 'diminuto') scaleMult = 0.5;
    else if (t === 'pequeno' || t === 'pequeño') scaleMult = 0.8;
    else if (t === 'enano') scaleMult = 0.75;
    else if (t === 'grande') scaleMult = 2;
    else if (t === 'enorme') scaleMult = 3;
    else if (t === 'gargantua') scaleMult = 4;
    else if (t === 'supergargantua' || t === 'supergargantura' || t === 'colosal') scaleMult = 6;
    else if (t === 'ultragargantua' || t === 'ultra gargantua' || t === 'ultra-gargantua' || t === 'ultragargantura') scaleMult = 10;
    else scaleMult = 1; // mediano

    if (ficha.gigante) scaleMult *= 2;
    return scaleMult;
  }

  function formatTamanioBase(val) {
    if (!val) return 'MEDIANO';
    const v = String(val).toLowerCase().trim();
    if (v === 'tiny' || v === 'diminuto') return 'TINY';
    if (v === 'pequeno' || v === 'pequeño') return 'PEQUEÑO';
    if (v === 'enano') return 'ENANO';
    if (v === 'mediano') return 'MEDIANO';
    if (v === 'grande') return 'GRANDE';
    if (v === 'enorme') return 'ENORME';
    if (v === 'gargantua') return 'GARGANTÚA';
    if (v === 'supergargantua' || v === 'supergargantura' || v === 'colosal') return 'SUPERGARGANTÚA';
    if (v === 'ultragargantua' || v === 'ultra gargantua' || v === 'ultra-gargantua' || v === 'ultragargantura') return 'ULTRA GARGANTÚA';
    return v.toUpperCase();
  }

  // Renderizado de Props / Capas de Utilería
  function drawSingleProp(prop, screenLeft, screenRight, screenTop, screenBottom, tSize) {
    if (!prop || !prop.imagen) return;
    if (prop.oculto && !state.usuario?.esDM) return;

    const wTiles = parseFloat(prop.ancho) || 2;
    const hTiles = parseFloat(prop.alto) || 2;
    const px = (parseFloat(prop.x) || 0) * tSize;
    const py = (parseFloat(prop.y) || 0) * tSize;
    const wPx = wTiles * tSize;
    const hPx = hTiles * tSize;
    const maxDim = Math.max(wTiles, hTiles);

    if (prop.x + maxDim < screenLeft || prop.x - maxDim > screenRight ||
      prop.y + maxDim < screenTop || prop.y - maxDim > screenBottom) {
      return;
    }

    const cx = px + wPx / 2;
    const cy = py + hPx / 2;

    let img = propImagesCache[prop.imagen];
    if (!img) {
      img = new Image();
      let src = prop.imagen;
      if (src && typeof src === 'string' && src.trim().startsWith('<svg')) {
        src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src.trim());
      }
      img.src = src;
      img.onload = () => markDirty();
      img.onerror = () => { img._failed = true; markDirty(); };
      propImagesCache[prop.imagen] = img;
    }

    ctx.save();
    if (prop.oculto) {
      ctx.globalAlpha = 0.5;
    }

    ctx.translate(cx, cy);
    if (prop.rotacion) {
      ctx.rotate((parseFloat(prop.rotacion) * Math.PI) / 180);
    }

    if (img.complete && img.naturalWidth > 0 && !img._failed) {
      ctx.drawImage(img, -wPx / 2, -hPx / 2, wPx, hPx);
    } else {
      ctx.fillStyle = 'rgba(201, 168, 76, 0.25)';
      ctx.fillRect(-wPx / 2, -hPx / 2, wPx, hPx);
      ctx.strokeStyle = '#c9a84c';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-wPx / 2, -hPx / 2, wPx, hPx);
      ctx.fillStyle = '#f0d060';
      ctx.font = 'bold 12px Roboto';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(prop.nombre || 'Objeto', 0, 0);
    }

    // Si el DM tiene seleccionado este prop: mostrar contorno dorado y botón de giro
    if (state.usuario?.esDM && selectedPropId === prop.id) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(-wPx / 2 - 2, -hPx / 2 - 2, wPx + 4, hPx + 4);
      ctx.setLineDash([]);

      if (prop.bloqueado) {
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 12px Roboto';
        ctx.textAlign = 'center';
        ctx.fillText('🔒 Bloqueado', 0, -hPx / 2 - 6);
      }
    }

    ctx.restore();
  }

  // Renderizado Principal del Tablero Optimizado
  function renderCanvas() {
    if (!ctx || !canvas) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const escCur = getEscenaActual();
    const cols = escCur?.config_grid_x || state.partida?.config_grid_x || 40;
    const rows = escCur?.config_grid_y || state.partida?.config_grid_y || 40;
    const tileSize = viewport.tileSize; // Se usa base para no escalar 2 veces
    const scaledTileSize = tileSize * viewport.zoom;

    // Viewport Real en Pantalla (sin recortar a 0..cols para que las fichas fuera del mapa no desaparezcan)
    const screenTileLeft = Math.floor(-viewport.panX / scaledTileSize) - 2;
    const screenTileRight = Math.ceil((canvas.width - viewport.panX) / scaledTileSize) + 2;
    const screenTileTop = Math.floor(-viewport.panY / scaledTileSize) - 2;
    const screenTileBottom = Math.ceil((canvas.height - viewport.panY) / scaledTileSize) + 2;

    // Líneas del Grid recortadas al mapa
    const gridColStart = Math.max(0, screenTileLeft);
    const gridColEnd = Math.min(cols, screenTileRight);
    const gridRowStart = Math.max(0, screenTileTop);
    const gridRowEnd = Math.min(rows, screenTileBottom);

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

    // 1. Dibujar Fondo Fuera del Mapa y Mapa de Fondo
    if (mapImage && mapImage.complete && mapImage.naturalWidth > 0) {
      ctx.drawImage(mapImage, 0, 0, mapWidth, mapHeight);
    } else {
      ctx.fillStyle = '#0d0d22';
      ctx.fillRect(0, 0, mapWidth, mapHeight);
    }

    // Borde delimitador dorado del mapa (para ver claramente los límites y saber si un token se salió)
    ctx.strokeStyle = 'rgba(201, 168, 76, 0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, mapWidth, mapHeight);

    // 1.5. Dibujar Capa Suelo de Props (debajo del grid)
    if (state.props && state.props.length > 0) {
      state.props.filter(p => p.capa === 'suelo').forEach(prop => {
        drawSingleProp(prop, screenTileLeft, screenTileRight, screenTileTop, screenTileBottom, tileSize);
      });
    }

    // 2. Dibujar Grid de Casillas (Solo las líneas visibles en el viewport dentro de los límites del mapa)
    ctx.strokeStyle = 'rgba(201, 168, 76, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = gridColStart; c <= gridColEnd; c++) {
      const cx = c * tileSize;
      ctx.moveTo(cx, gridRowStart * tileSize);
      ctx.lineTo(cx, gridRowEnd * tileSize);
    }
    for (let r = gridRowStart; r <= gridRowEnd; r++) {
      const ry = r * tileSize;
      ctx.moveTo(gridColStart * tileSize, ry);
      ctx.lineTo(gridColEnd * tileSize, ry);
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

    // 4. Dibujar Figuras Geométricas (Áreas de Efecto con Viewport Culling)
    if (state.figuras && state.figuras.length > 0) {
      state.figuras.forEach(fig => {
        const anchoCasillas = fig.ancho !== undefined ? parseFloat(fig.ancho) : (parseFloat(fig.tamanio) || 1);
        const largoCasillas = fig.alto !== undefined ? parseFloat(fig.alto) : (parseFloat(fig.tamanio) || 1);
        const maxRadius = Math.max(anchoCasillas, largoCasillas) + 1;
        // Culling: saltar figuras fuera de la pantalla
        if (fig.x + maxRadius < screenTileLeft || fig.x - maxRadius > screenTileRight ||
          fig.y + maxRadius < screenTileTop || fig.y - maxRadius > screenTileBottom) {
          return;
        }

        const centerX = fig.x * tileSize;
        const centerY = fig.y * tileSize;
        const wPx = anchoCasillas * tileSize;
        const hPx = largoCasillas * tileSize;

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
          if (fig.ancho !== undefined || fig.alto !== undefined) {
            const rx = wPx / 2;
            const ry = hPx / 2;
            if (Math.abs(rx - ry) < 0.1) {
              ctx.arc(0, 0, rx, 0, Math.PI * 2);
            } else {
              ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
            }
          } else {
            const radius = (parseFloat(fig.tamanio) || 1) * tileSize;
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
          }
          ctx.fill();
          ctx.stroke();
        } else if (fig.tipo === 'cuadrado' || fig.tipo === 'rectangulo') {
          const w = (fig.ancho !== undefined ? anchoCasillas : (fig.tipo === 'rectangulo' ? (fig.tamanio || 1) * 2 : (fig.tamanio || 1) * 2)) * tileSize;
          const h = (fig.alto !== undefined ? largoCasillas : (fig.tipo === 'rectangulo' ? (fig.tamanio || 1) * 4 : (fig.tamanio || 1) * 2)) * tileSize;
          ctx.fillRect(-w / 2, -h / 2, w, h);
          ctx.strokeRect(-w / 2, -h / 2, w, h);
        } else if (fig.tipo === 'cono') {
          const alcance = hPx;
          const mitadAncho = wPx / 2;
          const angulo = Math.atan2(mitadAncho, Math.max(1, alcance)) || (Math.PI / 4);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, alcance, -angulo, angulo);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }

        ctx.restore();
        ctx.save();

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

    // 4.5. Dibujar Capa Utilería de Props (debajo de las fichas, sobre figuras y mapa)
    if (state.props && state.props.length > 0) {
      state.props.filter(p => !p.capa || p.capa === 'debajo_fichas').forEach(prop => {
        drawSingleProp(prop, screenTileLeft, screenTileRight, screenTileTop, screenTileBottom, tileSize);
      });
    }

    // 5. Dibujar Fichas / Tokens de Personaje con Viewport Culling Real
    const selectedSet = new Set(selectedFichasIds);
    const fichasEnEscena = (state.fichas || []).filter(f => {
      const tipoLower = (f.tipo || '').toLowerCase().trim();
      const esJugador = !tipoLower || tipoLower === 'jugador' || tipoLower === 'personaje' || tipoLower === 'pj';
      return esJugador || f.escena_id === escCur?.id;
    });
    fichasEnEscena.forEach(ficha => {
      // Si la ficha está oculta por el DM: jugadores no la ven en absoluto, DM la ve translúcida
      if (ficha.oculto) {
        if (!state.usuario.esDM && !esDuenioDeFicha(ficha)) {
          return;
        }
      }

      // Multiplicador de tamaño (Tiny, Enano, Mediano, Grande, Enorme, Gargantúa, Supergargantúa, Gigante)
      const scaleMult = getFichaScaleMult(ficha);

      // Culling: omitir tokens fuera de la pantalla real visible (incluyendo coordenadas fuera del mapa)
      if (ficha.x + scaleMult < screenTileLeft || ficha.x > screenTileRight ||
        ficha.y + scaleMult < screenTileTop || ficha.y > screenTileBottom) {
        return;
      }

      const isMonster = ficha.tipo === 'monstruo' || ficha.tipo === 'npc';
      const isPlayerView = !state.usuario.esDM;
      const visibility = getFichaVisibility(ficha);

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

      // Dibujar Imagen o Avatar del Token
      const radius = tokenWidth / 2;
      const cx = px + radius;
      const cy = py + radius;

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.clip();

      if (isMonster && isPlayerView && !visibility.imagen) {
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
          img.onerror = () => { img._failed = true; markDirty(); };
        }
        if (img.complete && img.naturalWidth > 0 && !img._failed) {
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

      // Borde exterior nítido si está seleccionada (render rápido sin software shadow blur)
      if (selectedSet.has(ficha.id)) {
        ctx.save();
        ctx.strokeStyle = '#f0d060';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Aureola animada de Combate (render rápido con gradiente alfa en lugar de shadowBlur)
      const esTurnoCombate = state.combate && state.combate.activo &&
        state.combate.participantes &&
        state.combate.participantes[state.combate.turnoIndex]?.id === ficha.id;

      if (esTurnoCombate) {
        ctx.save();
        const pulse = (Math.sin(Date.now() / 250) + 1) / 2; // 0 a 1 suave
        const haloR = radius + 5 + pulse * 3;
        ctx.strokeStyle = `rgba(240, 208, 96, ${0.75 + pulse * 0.25})`;
        ctx.lineWidth = 3 + pulse * 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = `rgba(201, 168, 76, ${0.3 + pulse * 0.3})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, haloR + 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Dibujar Borde Dorado del Token (o del color del aro)
      const colorAro = ficha.color_aro || '#c9a84c';
      ctx.strokeStyle = colorAro;
      ctx.lineWidth = ficha.color_aro ? 3 : 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      // Si tiene color_aro personalizado, leve resplandor limpio
      if (ficha.color_aro) {
        ctx.strokeStyle = colorAro;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 5;
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
      const displayName = (isMonster && isPlayerView && !visibility.nombre) ? 'Desconocido' : ficha.nombre;
      const showName = !isMonster || !isPlayerView || visibility.nombre;

      // Usar barra_hp visibility para la barra de vida visual
      const showBar = showHpBars && (!isMonster || !isPlayerView || visibility.barra_hp);
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

        // Nombre encima de la barra (solo si está revelado) con contorno de alto contraste
        if (showName) {
          ctx.font = 'bold 13px Roboto, sans-serif';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
          ctx.strokeText(displayName, cx, py - 22);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(displayName, cx, py - 22);
        }
      } else if (showName) {
        // Solo nombre, sin barra con contorno de alto contraste
        ctx.font = 'bold 13px Roboto, sans-serif';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.strokeText(displayName, cx, py - 6);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(displayName, cx, py - 6);
      }
      ctx.restore();

      // 5.4. Dibujar Recuadros Pequeños con Iconos/Imágenes de Efectos encima del Token [ALPHA]
      drawTokenAlphaEffects(ctx, ficha, cx, cy, px, py, tokenWidth, tokenHeight, showBar, showName);

      // Si la ficha está fuera de los límites del mapa, dibujar aro de advertencia para verla claramente
      const isOutOfMap = ficha.x < 0 || ficha.x + scaleMult > cols || ficha.y < 0 || ficha.y + scaleMult > rows;
      if (isOutOfMap) {
        ctx.save();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 11px Roboto';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#000000';
        ctx.shadowBlur = 4;
        ctx.fillText('⚠️ Fuera de mapa', cx, py + tokenHeight + 14);
        ctx.restore();
      }

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

    // 5.5. Dibujar Capa Techo de Props (por encima de las fichas)
    if (state.props && state.props.length > 0) {
      state.props.filter(p => p.capa === 'encima_fichas').forEach(prop => {
        drawSingleProp(prop, screenTileLeft, screenTileRight, screenTileTop, screenTileBottom, tileSize);
      });
    }

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

  // --- DIBUJADO DE RECUADROS DE EFECTOS VISUALES EN TOKENS [ALPHA] ---
  function drawTokenAlphaEffects(ctx, ficha, cx, cy, px, py, tokenWidth, tokenHeight, showBar, showName) {
    if (state.alphaTokenEffects === false) return;
    let efectosList = [];
    if (Array.isArray(ficha.efectos)) {
      efectosList = ficha.efectos;
    } else if (typeof ficha.efectos === 'string' && ficha.efectos.trim()) {
      try { efectosList = JSON.parse(ficha.efectos); } catch (_) { efectosList = []; }
    }
    if (!efectosList || efectosList.length === 0) return;

    ctx.save();
    // Tamaño nítido del recuadro (mín 16px, máx 28px, ajustado a escala de pantalla)
    const badgeSize = Math.max(16, Math.min(28, tokenWidth * 0.28));
    const badgeGap = 3;
    const maxBadges = 5;
    const displayBadges = efectosList.slice(0, maxBadges);
    const hasMore = efectosList.length > maxBadges;
    const totalCount = displayBadges.length + (hasMore ? 1 : 0);
    const totalW = totalCount * badgeSize + (totalCount - 1) * badgeGap;

    // Posición vertical: flotando directamente encima de la barra de vida y el nombre
    const topOffset = (showBar ? 26 : 8) + (showName ? 18 : 0) + badgeSize + 2;
    const by = py - topOffset;
    const startX = cx - totalW / 2;

    displayBadges.forEach((ef, idx) => {
      const bx = startX + idx * (badgeSize + badgeGap);
      const bColor = ef.color || '#c9a84c';

      // 1. Recuadro oscuro semi-transparente
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(bx, by, badgeSize, badgeSize, 4);
      } else {
        ctx.rect(bx, by, badgeSize, badgeSize);
      }
      ctx.fill();

      // 2. Borde exterior coloreado
      ctx.strokeStyle = bColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 3. Contenido: Imagen personalizada o Icono/Emoji D&D
      if (ef.imagen && typeof ef.imagen === 'string' && ef.imagen.startsWith('http')) {
        const cachedImg = getEffectImageCached(ef.imagen);
        if (cachedImg && cachedImg.complete && cachedImg.naturalWidth > 0) {
          ctx.drawImage(cachedImg, bx + 2, by + 2, badgeSize - 4, badgeSize - 4);
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.font = `${Math.floor(badgeSize * 0.65)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(ef.icono || '✨', bx + badgeSize / 2, by + badgeSize / 2 + 1);
        }
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.font = `${Math.floor(badgeSize * 0.68)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ef.icono || '✨', bx + badgeSize / 2, by + badgeSize / 2 + 1);
      }
    });

    // Indicador numérico "+N" si hay más de 5 efectos en la misma ficha
    if (hasMore) {
      const plusBx = startX + displayBadges.length * (badgeSize + badgeGap);
      ctx.fillStyle = 'rgba(201, 168, 76, 0.95)';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(plusBx, by, badgeSize, badgeSize, 4);
      } else {
        ctx.rect(plusBx, by, badgeSize, badgeSize);
      }
      ctx.fill();
      ctx.fillStyle = '#0b0f19';
      ctx.font = `bold ${Math.floor(badgeSize * 0.52)}px Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`+${efectosList.length - maxBadges}`, plusBx + badgeSize / 2, by + badgeSize / 2 + 1);
    }

    ctx.restore();
  }

  let lastMoveEmitTime = 0;
  let debounceSaveFigTimer = null;
  function debouncedSaveFigure(fig) {
    if (debounceSaveFigTimer) clearTimeout(debounceSaveFigTimer);
    debounceSaveFigTimer = setTimeout(() => {
      const escCur = getEscenaActual();
      if (state.partida?.id && escCur?.id && fig) {
        socket?.emit('guardar_figura', {
          partidaId: state.partida.id,
          escenaId: escCur.id,
          figuraData: fig
        });
      }
    }, 250);
  }

  // --- MANEJADORES DE EVENTOS MOUSE / TOUCH EN CANVAS ---
  function handleMouseDown(e) {
    tokenDidActuallyMove = false;
    propDidActuallyMove = false;
    figureDidActuallyMove = false;

    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      const tag = document.activeElement.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') {
        document.activeElement.blur();
      }
    }
    updateCanvasRect();
    const gridPos = screenToGrid(e.clientX, e.clientY);
    const escenaCur = getEscenaActual();

    // Activar manejadores en window para arrastre fluido aunque el puntero salga del canvas
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    // Modo tocar casilla para mover (móvil)
    if (mobileTapToMoveActive && selectedFichasIds && selectedFichasIds.length > 0) {
      const ficha = state.fichas.find(f => f.id === selectedFichasIds[0]);
      if (ficha && (state.usuario?.esDM || esDuenioDeFicha(ficha))) {
        const targetX = Math.round(gridPos.x);
        const targetY = Math.round(gridPos.y);
        ficha.x = targetX;
        ficha.y = targetY;
        socket?.emit('guardar_posicion_ficha', {
          partidaId: state.partida.id,
          escenaId: escenaCur?.id,
          fichaId: ficha.id,
          x: ficha.x,
          y: ficha.y
        });
        showToast(`📍 ${ficha.nombre} movido a (${targetX}, ${targetY})`, 'gold');
        mobileTapToMoveActive = false;
        if (dom.mtBtnTapMove) {
          dom.mtBtnTapMove.classList.remove('active-tap-move');
          if (dom.mtTapMoveText) dom.mtTapMoveText.textContent = 'Tocar para Mover';
        }
        markDirty();
        return;
      }
    }

    if (activeTool === 'move' || activeTool === 'props') {
      // 1. Buscar si hizo clic sobre alguna ficha visible en la escena actual
      const fichasEnEscena = (state.fichas || []).filter(f => {
        const tipoLower = (f.tipo || '').toLowerCase().trim();
        const esJugador = !tipoLower || tipoLower === 'jugador' || tipoLower === 'personaje' || tipoLower === 'pj';
        if (!esJugador && f.escena_id !== escenaCur?.id) return false;
        if (f.oculto && !state.usuario.esDM && !esDuenioDeFicha(f)) return false;
        return true;
      });

      let candidataControlable = null;
      let candidataGeneral = null;

      for (let i = fichasEnEscena.length - 1; i >= 0; i--) {
        const f = fichasEnEscena[i];
        const mult = getFichaScaleMult(f);
        const fx = parseFloat(f.x) || 0;
        const fy = parseFloat(f.y) || 0;
        const pad = 0.25;
        if (gridPos.x >= fx - pad && gridPos.x <= fx + mult + pad && gridPos.y >= fy - pad && gridPos.y <= fy + mult + pad) {
          if (!candidataGeneral) candidataGeneral = f;
          if (esDuenioDeFicha(f)) {
            candidataControlable = f;
            break;
          }
        }
      }

      const clickedFicha = candidataControlable || candidataGeneral;

      if (clickedFicha) {
        const esDuenio = esDuenioDeFicha(clickedFicha);
        if (esDuenio) {
          const isMulti = e.shiftKey || isMultiSelectMode;
          if (!isMulti) {
            selectedFichasIds = [clickedFicha.id];
          } else {
            if (selectedFichasIds.includes(clickedFicha.id)) {
              selectedFichasIds = selectedFichasIds.filter(id => id !== clickedFicha.id);
            } else {
              selectedFichasIds.push(clickedFicha.id);
            }
          }

          // Para jugadores normales, filtrar que solo estén fichas que posean
          if (!state.usuario?.esDM) {
            selectedFichasIds = selectedFichasIds.filter(id => {
              const f = (state.fichas || []).find(fi => fi.id === id);
              return f && esDuenioDeFicha(f);
            });
          }

          updateMultiSelectBadge();
          if (dom.diceTokenSelect) {
            dom.diceTokenSelect.value = selectedFichasIds[0] || '';
            if (selectedFichasIds[0] && dom.diceTokenSelect.selectedIndex <= 0) {
              renderTokenSelects();
              dom.diceTokenSelect.value = selectedFichasIds[0];
            }
          }
          updateDiceEffectsBanner();
          isDraggingToken = selectedFichasIds.length > 0;

          dragOffsets = {};
          selectedFichasIds.forEach(id => {
            const f = state.fichas.find(fi => fi.id === id);
            if (f) {
              dragOffsets[id] = { x: gridPos.x - f.x, y: gridPos.y - f.y };
            }
          });

          showMobileTokenActionBar(clickedFicha);
          renderFichasList();
          markDirty();
          return;
        }
      }

      // 2. Buscar si hizo clic sobre algún Prop / Utilería
      if (state.usuario.esDM && (state.props || []).length > 0 && !isDraggingToken) {
        const clickedProp = (state.props || []).slice().reverse().find(p => {
          const px = parseFloat(p.x) || 0;
          const py = parseFloat(p.y) || 0;
          const pw = parseFloat(p.ancho) || 2;
          const ph = parseFloat(p.alto) || 2;
          return gridPos.x >= px && gridPos.x <= px + pw && gridPos.y >= py && gridPos.y <= py + ph;
        });

        if (clickedProp) {
          selectedPropId = clickedProp.id;
          if (!clickedProp.bloqueado) {
            isDraggingProp = true;
            propDragOffset = { x: gridPos.x - clickedProp.x, y: gridPos.y - clickedProp.y };
          }
          renderPropsList();
          markDirty();
          return;
        } else if (activeTool === 'props') {
          selectedPropId = null;
          renderPropsList();
          markDirty();
        }
      }
    } else if (activeTool === 'measure') {
      measureStart = gridPos;
      measureCurrent = gridPos;
    } else if (activeTool === 'draw' && state.usuario.esDM) {
      isDrawing = true;
      currentStroke = [{ x: gridPos.x, y: gridPos.y }];
    }

    // Lógica para seleccionar y crear figuras exclusiva de herramienta 'figures'
    if (activeTool === 'figures') {
      const clickedFig = (state.figuras || []).find(fig => {
        const halfW = ((fig.ancho !== undefined ? fig.ancho : (fig.tamanio * 2)) || 2) / 2;
        const halfH = ((fig.alto !== undefined ? fig.alto : (fig.tamanio * 2)) || 2) / 2;
        return gridPos.x >= fig.x - halfW && gridPos.x <= fig.x + halfW &&
          gridPos.y >= fig.y - halfH && gridPos.y <= fig.y + halfH;
      });

      if (clickedFig && !isDraggingToken && !isDraggingProp) {
        const canControl = state.usuario.esDM || clickedFig.creador_id === state.usuario.id;
        if (canControl) {
          selectedFigureId = clickedFig.id;
          isDraggingFigure = true;
          dragOffset = { x: gridPos.x - clickedFig.x, y: gridPos.y - clickedFig.y };

          if (dom.figType) dom.figType.value = clickedFig.tipo;
          if (dom.figSize) dom.figSize.value = clickedFig.ancho !== undefined ? clickedFig.ancho : (clickedFig.tamanio || 1);
          if (dom.figHeight) dom.figHeight.value = clickedFig.alto !== undefined ? clickedFig.alto : (clickedFig.tamanio || 1);
          if (dom.figRotation) dom.figRotation.value = clickedFig.rotacion || 0;
          if (dom.figColor) dom.figColor.value = clickedFig.color || '#c9a84c';
          if (dom.figOpacity) dom.figOpacity.value = clickedFig.transparencia || 0.4;
          if (dom.figLabel) dom.figLabel.value = clickedFig.etiqueta || '';
        } else {
          selectedFigureId = null;
        }

        markDirty();
        return;
      }

      // Si no hizo clic sobre una figura existente y estamos en 'figures', creamos una nueva
      figureStart = gridPos;
      const newFigId = 'fig_' + Math.random().toString(36).substr(2, 9);
      const anchoVal = parseFloat(dom.figSize.value) || 1;
      const altoVal = parseFloat(dom.figHeight ? dom.figHeight.value : dom.figSize.value) || anchoVal;
      const nuevaFig = {
        id: newFigId,
        tipo: dom.figType.value,
        x: Math.round(gridPos.x),
        y: Math.round(gridPos.y),
        tamanio: anchoVal,
        ancho: anchoVal,
        alto: altoVal,
        rotacion: parseFloat(dom.figRotation?.value || 0),
        color: dom.figColor.value,
        transparencia: parseFloat(dom.figOpacity.value),
        etiqueta: dom.figLabel.value,
        creador_id: state.usuario.id
      };

      selectedFigureId = newFigId;
      socket?.emit('guardar_figura', { partidaId: state.partida.id, escenaId: escenaCur?.id, figuraData: nuevaFig });

      if (dom.figLabel) dom.figLabel.value = '';
      markDirty();
      return;
    }

    // Si llegamos aquí y es move, hacemos pan sin ser bloqueado por figuras
    if (activeTool === 'move' && !isDraggingToken && !isDraggingFigure && !isDraggingProp) {
      selectedFigureId = null;
      selectedPropId = null;
      if (!clickedFicha && !mobileTapToMoveActive) {
        hideMobileTokenActionBar();
      }
      isPanning = true;
      panStart = { x: e.clientX - viewport.panX, y: e.clientY - viewport.panY };
    } else if (activeTool === 'erase') {
      const figToDel = (state.figuras || []).find(fig => {
        if (fig.creador_id !== state.usuario.id && !state.usuario.esDM) return false;
        const maxDim = Math.max(fig.ancho || fig.tamanio || 1, fig.alto || fig.tamanio || 1);
        return Math.hypot(fig.x - gridPos.x, fig.y - gridPos.y) <= maxDim;
      });
      if (figToDel) {
        socket?.emit('eliminar_figura', { partidaId: state.partida.id, escenaId: escenaCur?.id, figuraId: figToDel.id });
      }

      if (state.usuario?.esDM && Array.isArray(state.dibujos) && state.dibujos.length > 0) {
        const strokeIdx = state.dibujos.findIndex(stroke => {
          if (!stroke.points || !Array.isArray(stroke.points)) return false;
          const hitRadius = (stroke.size ? stroke.size / 50 : 0.4) + 0.35;
          return stroke.points.some(p => Math.hypot(p.x - gridPos.x, p.y - gridPos.y) <= hitRadius);
        });
        if (strokeIdx !== -1) {
          state.dibujos.splice(strokeIdx, 1);
          markDirty();
          debounceLocalMirrorSave();
          if (state.partida?.id && escenaCur?.id) {
            socket?.emit('guardar_dibujos', {
              partidaId: state.partida.id,
              escenaId: escenaCur.id,
              datos: state.dibujos
            });
          }
        }
      }
    }
  }

  function handleWindowMouseMove(e) {
    if (isDraggingToken || isDraggingFigure || isDraggingProp || isPanning) {
      handleMouseMove(e);
    }
  }

  function handleWindowMouseUp(e) {
    handleMouseUp();
  }

  function handleMouseMove(e) {
    const gridPos = screenToGrid(e.clientX, e.clientY);
    const escenaCur = getEscenaActual();

    if (isDraggingToken && selectedFichasIds.length > 0) {
      const now = Date.now();
      let didMove = false;

      selectedFichasIds.forEach(id => {
        const ficha = state.fichas.find(f => f.id === id);
        if (ficha) {
          if (!state.usuario?.esDM && !esDuenioDeFicha(ficha)) return;
          const offset = dragOffsets[id] || { x: 0.5, y: 0.5 };
          ficha.x = gridPos.x - offset.x;
          ficha.y = gridPos.y - offset.y;
          didMove = true;

          if (now - lastMoveEmitTime > 40) {
            socket?.emit('mover_ficha', {
              partidaId: state.partida.id,
              escenaId: escenaCur?.id,
              fichaId: ficha.id,
              x: ficha.x,
              y: ficha.y
            });
          }
        }
      });

      if (didMove) {
        tokenDidActuallyMove = true;
        if (now - lastMoveEmitTime > 40) {
          lastMoveEmitTime = now;
        }
        markDirty();
      }
    } else if (isDraggingProp && selectedPropId) {
      const prop = (state.props || []).find(p => p.id === selectedPropId);
      if (prop) {
        propDidActuallyMove = true;
        prop.x = gridPos.x - propDragOffset.x;
        prop.y = gridPos.y - propDragOffset.y;
        markDirty();
        const now = Date.now();
        if (now - lastMoveEmitTime > 40) {
          lastMoveEmitTime = now;
          socket?.emit('mover_prop', {
            partidaId: state.partida.id,
            escenaId: escenaCur?.id,
            propId: prop.id,
            x: prop.x,
            y: prop.y
          });
        }
      }
    } else if (isDraggingFigure && selectedFigureId) {
      const fig = state.figuras.find(f => f.id === selectedFigureId);
      if (fig) {
        figureDidActuallyMove = true;
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
    window.removeEventListener('mousemove', handleWindowMouseMove);
    window.removeEventListener('mouseup', handleWindowMouseUp);

    const escenaCur = getEscenaActual();

    if (isDraggingToken && selectedFichasIds.length > 0) {
      if (tokenDidActuallyMove) {
        selectedFichasIds.forEach(id => {
          const ficha = state.fichas.find(f => f.id === id);
          if (ficha) {
            if (!state.usuario?.esDM && !esDuenioDeFicha(ficha)) return;
            ficha.x = Math.round(ficha.x);
            ficha.y = Math.round(ficha.y);
            socket?.emit('guardar_posicion_ficha', {
              partidaId: state.partida.id,
              escenaId: escenaCur?.id,
              fichaId: ficha.id,
              x: ficha.x,
              y: ficha.y
            });
          }
        });
      }
      tokenDidActuallyMove = false;
    }

    if (isDraggingProp && selectedPropId) {
      if (propDidActuallyMove) {
        const prop = (state.props || []).find(p => p.id === selectedPropId);
        if (prop) {
          prop.x = Math.round(prop.x * 2) / 2;
          prop.y = Math.round(prop.y * 2) / 2;
          socket?.emit('guardar_posicion_prop', {
            partidaId: state.partida.id,
            escenaId: escenaCur?.id,
            propId: prop.id,
            x: prop.x,
            y: prop.y
          });
        }
      }
      isDraggingProp = false;
      propDidActuallyMove = false;
      markDirty();
    }

    if (isDraggingFigure && selectedFigureId) {
      if (figureDidActuallyMove) {
        const fig = state.figuras.find(f => f.id === selectedFigureId);
        if (fig) {
          socket?.emit('guardar_figura', {
            partidaId: state.partida.id,
            escenaId: escenaCur?.id,
            figuraData: fig
          });
        }
      }
      isDraggingFigure = false;
      figureDidActuallyMove = false;
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
        escenaId: escenaCur?.id,
        datos: state.dibujos
      });
    }

    isDraggingToken = false;
    isDraggingProp = false;
    isPanning = false;
    measureStart = null;
    measureCurrent = null;
    isDrawing = false;
    currentStroke = [];
    markDirty();
  }

  function handleWheel(e) {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    zoomAt(e.clientX, e.clientY, zoomFactor);
  }

  function zoomAt(screenX, screenY, factor) {
    const newZoom = Math.max(0.05, Math.min(4.0, viewport.zoom * factor));
    if (newZoom === viewport.zoom) return;
    const rect = cachedCanvasRect || (canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0 });
    const mouseX = screenX - rect.left;
    const mouseY = screenY - rect.top;

    viewport.panX = mouseX - (mouseX - viewport.panX) * (newZoom / viewport.zoom);
    viewport.panY = mouseY - (mouseY - viewport.panY) * (newZoom / viewport.zoom);
    viewport.zoom = newZoom;

    if (dom.zoomLevelText) dom.zoomLevelText.textContent = `${Math.round(viewport.zoom * 100)}%`;
    markDirty();
  }

  // SOPORTE EVENTOS TÁCTILES MÓVIL (ZOOM, PAN Y ARRASTRE MULTITÁCTIL)
  let touchStartDist = 0;
  let touchStartMid = null;
  let touchLastPan = null;
  let touchSingleStartPos = null;
  let touchMovedBeyondSlop = false;
  const TOUCH_SLOP_THRESHOLD = 8; // Umbral de píxeles para separar un toque simple de un arrastre

  function handleTouchStart(e) {
    if (e.cancelable) e.preventDefault();
    updateCanvasRect();

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      touchStartDist = 0;
      touchStartMid = null;
      touchLastPan = null;
      touchSingleStartPos = { x: touch.clientX, y: touch.clientY };
      touchMovedBeyondSlop = false;
      handleMouseDown({ clientX: touch.clientX, clientY: touch.clientY, button: 0 });
    } else if (e.touches.length === 2) {
      // Al colocar un segundo dedo, cancelar arrastres de fichas o figuras para iniciar gesto de zoom/pan
      if (isDraggingToken) {
        isDraggingToken = false;
        draggedToken = null;
        draggedTokensInitialPositions = {};
      }
      if (isDraggingFigure) {
        isDraggingFigure = false;
      }
      if (isDraggingProp) {
        isDraggingProp = false;
        draggedProp = null;
      }
      isPanning = false;

      const t0 = e.touches[0];
      const t1 = e.touches[1];
      touchStartDist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      touchStartMid = {
        x: (t0.clientX + t1.clientX) / 2,
        y: (t0.clientY + t1.clientY) / 2
      };
      touchLastPan = { x: touchStartMid.x, y: touchStartMid.y };
    }
  }

  function handleTouchMove(e) {
    if (e.cancelable) e.preventDefault();

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      if (!touchMovedBeyondSlop && touchSingleStartPos) {
        const dist = Math.hypot(touch.clientX - touchSingleStartPos.x, touch.clientY - touchSingleStartPos.y);
        if (dist >= TOUCH_SLOP_THRESHOLD) {
          touchMovedBeyondSlop = true;
        }
      }

      // Si no ha superado el umbral (tap táctil con vibración natural involuntaria), no arrastrar
      if (touchMovedBeyondSlop) {
        handleMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
      }
    } else if (e.touches.length === 2) {
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const midX = (t0.clientX + t1.clientX) / 2;
      const midY = (t0.clientY + t1.clientY) / 2;

      // 1. Paneo con dos dedos
      if (touchLastPan) {
        const dx = midX - touchLastPan.x;
        const dy = midY - touchLastPan.y;
        viewport.panX += dx;
        viewport.panY += dy;
        touchLastPan = { x: midX, y: midY };
      }

      // 2. Pellizco / Pinch Zoom
      const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      if (touchStartDist > 0 && Math.abs(dist - touchStartDist) > 1) {
        const factor = dist / touchStartDist;
        zoomAt(midX, midY, factor);
      }
      touchStartDist = dist;
      markDirty();
    }
  }

  function handleTouchEnd(e) {
    if (e.cancelable) e.preventDefault();

    if (e.touches.length === 1) {
      // Queda un dedo en pantalla: sincronizar panStart para evitar saltos bruscos
      const touch = e.touches[0];
      touchStartDist = 0;
      touchStartMid = null;
      touchLastPan = null;
      touchSingleStartPos = { x: touch.clientX, y: touch.clientY };
      touchMovedBeyondSlop = false;
      panStart.x = touch.clientX - viewport.panX;
      panStart.y = touch.clientY - viewport.panY;
      if (activeTool === 'pan') {
        isPanning = true;
      }
    } else if (e.touches.length === 0) {
      touchStartDist = 0;
      touchStartMid = null;
      touchLastPan = null;

      // Si fue solo un toque rápido sin superar el slop, limpiar banderas sin guardar coordenadas alteradas
      if (!touchMovedBeyondSlop) {
        isDraggingToken = false;
        isDraggingProp = false;
        isDraggingFigure = false;
        isPanning = false;
        isDrawing = false;
        window.removeEventListener('mousemove', handleWindowMouseMove);
        window.removeEventListener('mouseup', handleWindowMouseUp);
        markDirty();
      } else {
        handleMouseUp();
      }
      touchSingleStartPos = null;
      touchMovedBeyondSlop = false;
    }
  }

  function handleTouchCancel(e) {
    touchStartDist = 0;
    touchStartMid = null;
    touchLastPan = null;
    touchSingleStartPos = null;
    touchMovedBeyondSlop = false;
    isDraggingToken = false;
    isDraggingProp = false;
    isDraggingFigure = false;
    isPanning = false;
    isDrawing = false;
    window.removeEventListener('mousemove', handleWindowMouseMove);
    window.removeEventListener('mouseup', handleWindowMouseUp);
    markDirty();
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

    // --- CONTROLES DE COMBATE & TURN TRACKER ---
    dom.btnOpenCombatModal?.addEventListener('click', () => openCombatSetupModal(state.combate?.activo));
    dom.toolCombat?.addEventListener('click', () => openCombatSetupModal(state.combate?.activo));
    dom.btnCombatAddParticipant?.addEventListener('click', () => openCombatSetupModal(true));
    dom.btnCombatAddConfirm?.addEventListener('click', confirmAddParticipantsToCombat);

    dom.btnCombatSelectAll?.addEventListener('click', () => {
      if (!dom.combatSetupTbody) return;
      const checks = dom.combatSetupTbody.querySelectorAll('.combat-token-check');
      const allChecked = Array.from(checks).every(c => c.checked);
      checks.forEach(c => c.checked = !allChecked);
      if (dom.combatSelectMaster) dom.combatSelectMaster.checked = !allChecked;
    });

    dom.combatSelectMaster?.addEventListener('change', (e) => {
      if (!dom.combatSetupTbody) return;
      const checks = dom.combatSetupTbody.querySelectorAll('.combat-token-check');
      checks.forEach(c => c.checked = e.target.checked);
    });

    dom.btnCombatRollAll?.addEventListener('click', rollAllCombatInitiatives);

    dom.btnCombatStartConfirm?.addEventListener('click', confirmStartCombat);

    dom.btnCombatNext?.addEventListener('click', () => {
      if (state.partida?.id) {
        socket.emit('siguiente_turno', { partidaId: state.partida.id });
      }
    });

    dom.btnPlayerEndTurn?.addEventListener('click', () => {
      if (state.partida?.id) {
        socket.emit('siguiente_turno', { partidaId: state.partida.id });
      }
    });

    dom.btnCombatPrev?.addEventListener('click', () => {
      if (state.partida?.id) {
        socket.emit('anterior_turno', { partidaId: state.partida.id });
      }
    });

    dom.btnCombatEnd?.addEventListener('click', () => {
      if (confirm('¿Estás seguro de que deseas finalizar el combate?')) {
        if (state.partida?.id) {
          socket.emit('terminar_combate', { partidaId: state.partida.id });
        }
      }
    });

    dom.btnMultiSelectMode?.addEventListener('click', () => {
      isMultiSelectMode = !isMultiSelectMode;
      dom.btnMultiSelectMode.classList.toggle('active', isMultiSelectMode);
      updateMultiSelectBadge();
    });

    // Menús y Navegación & Botones Inicio
    dom.btnNavInicio?.addEventListener('click', async () => {
      if (state.partida && state.partida.codigo) {
        const salir = confirm('¿Deseas volver a la pantalla de inicio? Tu partida sigue guardada de forma segura.');
        if (!salir) return;
        const partidaIdToSave = state.partida.id;
        localStorage.removeItem('vtt_active_game_code');
        sessionStorage.removeItem('vtt_in_session');

        // Guardado garantizado en disco antes de volver a la pantalla de inicio
        if (partidaIdToSave) {
          try {
            fetch(`/api/partidas/${partidaIdToSave}/guardar_ahora`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ snapshot: false }),
              keepalive: true
            }).catch(() => { });
          } catch (_) { }
        }
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
    dom.btnCreateGameModal?.addEventListener('click', () => {
      openModal(dom.modalCreateGame);
      const dmNameEl = document.getElementById('create-dm-name');
      if (dmNameEl && !dmNameEl.value.trim()) {
        const saved = localStorage.getItem('vtt_username');
        dmNameEl.value = saved || '';
        dmNameEl.placeholder = 'Tu nombre de Dungeon Master (ej: DM Arturo)';
      }
      const titleEl = document.getElementById('create-game-title');
      if (titleEl) {
        setTimeout(() => titleEl.focus(), 150);
      }
    });

    dom.btnJoinGameModal?.addEventListener('click', () => {
      loadJoinModalSessionsList();
      openModal(dom.modalJoinGame);
      setTimeout(() => {
        if (dom.joinUsernameInput && !dom.joinUsernameInput.value.trim()) {
          const savedName = localStorage.getItem('vtt_username');
          if (savedName) dom.joinUsernameInput.value = savedName;
        }
      }, 100);
    });

    if (dom.btnImportGame && dom.inputImportGameFile) {
      dom.btnImportGame.addEventListener('click', () => dom.inputImportGameFile.click());
      dom.inputImportGameFile.addEventListener('change', handleImportSessionFile);
    }

    if (dom.btnDmExportSession) {
      dom.btnDmExportSession.addEventListener('click', () => {
        if (state.partida?.id) {
          descargarPartidaAlPc(state.partida.id, state.partida.nombre, state.partida.codigo);
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

      const nombre = (titleEl && titleEl.value.trim()) ? titleEl.value.trim() : 'Nueva Partida';
      const dmName = (dmNameEl && dmNameEl.value.trim()) ? dmNameEl.value.trim() : (localStorage.getItem('vtt_username') || 'Dungeon Master');

      let imagenPortada = imgUrlEl ? imgUrlEl.value.trim() : '';
      if (imgFileEl && imgFileEl.files && imgFileEl.files[0]) {
        try {
          const comp = await compressImageFile(imgFileEl.files[0], 800, 500, 0.82);
          if (comp) imagenPortada = comp;
        } catch (_) { }
      }

      localStorage.setItem('vtt_username', dmName);
      const deterministicId = 'usr_' + dmName.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
      state.usuario.id = deterministicId;
      state.usuario.nombre = dmName;
      localStorage.setItem('vtt_user_id', deterministicId);

      const submitBtn = dom.formCreateGame.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creando...';
      }

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

        // Unirse automáticamente y directo sin recargar la página
        joinGameDirect(data.codigo, dmName);
      } catch (err) {
        alert('Error al crear la partida: ' + err.message);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = 'Crear Partida';
        }
      }
    });

    dom.formJoinGame?.addEventListener('submit', (e) => {
      e.preventDefault();
      const codigo = (dom.joinCodeInput?.value || document.getElementById('join-code-input')?.value || '').trim();
      const nombreUsuario = (dom.joinUsernameInput?.value || document.getElementById('join-username-input')?.value || '').trim();

      if (!codigo) {
        alert('Por favor introduce el código de la partida.');
        return;
      }
      if (!nombreUsuario) {
        alert('Por favor introduce tu nombre de jugador.');
        return;
      }

      localStorage.setItem('vtt_username', nombreUsuario);
      localStorage.setItem('vtt_username_explicit', '1');
      updateLobbyUserDisplay();
      closeModal(dom.modalJoinGame);
      joinGameDirect(codigo, nombreUsuario);
    });

    // Modal Cambiar Nombre de Usuario / Perfil
    dom.btnLobbyChangeUser?.addEventListener('click', () => {
      openModal(dom.modalChangeUser);
      setTimeout(() => {
        if (dom.inputChangeUsername) {
          dom.inputChangeUsername.value = localStorage.getItem('vtt_username') || state.usuario?.nombre || '';
          dom.inputChangeUsername.focus();
        }
      }, 100);
    });

    dom.userRoleBadge?.addEventListener('click', () => {
      openModal(dom.modalChangeUser);
      setTimeout(() => {
        if (dom.inputChangeUsername) {
          dom.inputChangeUsername.value = state.usuario?.nombre || localStorage.getItem('vtt_username') || '';
          dom.inputChangeUsername.focus();
        }
      }, 100);
    });

    dom.formChangeUser?.addEventListener('submit', (e) => {
      e.preventDefault();
      const newName = (dom.inputChangeUsername?.value || '').trim();
      if (!newName) {
        alert('Por favor introduce un nombre válido.');
        return;
      }

      localStorage.setItem('vtt_username', newName);
      localStorage.setItem('vtt_username_explicit', '1');
      const deterministicId = 'usr_' + newName.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
      state.usuario.id = deterministicId;
      state.usuario.nombre = newName;
      localStorage.setItem('vtt_user_id', deterministicId);

      updateLobbyUserDisplay();

      // Si estamos en una partida activa, emitir al servidor
      if (socket && socket.connected && state.partida?.id) {
        socket.emit('cambiar_nombre_usuario', { nuevoNombre: newName });
      }

      if (dom.userRoleText) {
        dom.userRoleText.textContent = state.usuario.esDM ? `DM: ${newName}` : newName;
      }

      closeModal(dom.modalChangeUser);
      showToast(`👤 Nombre guardado: ${newName}`, 'gold');
    });

    function ejecutarReclamarDM() {
      if (!state.partida?.id) {
        showToast('Debes estar en una partida para asumir el rol de DM', 'error');
        return;
      }
      socket?.emit('reclamar_dm', { partidaId: state.partida.id });
      state.usuario.esDM = true;
      updateUIForCurrentGame();
      closeModal(dom.modalChangeUser);
      showToast('👑 ¡Has asumido el rol de Dungeon Master!', 'gold');
    }

    dom.btnReclamarDm?.addEventListener('click', ejecutarReclamarDM);
    dom.btnQuickClaimDm?.addEventListener('click', ejecutarReclamarDM);

    // Barra inline de nombre de usuario en el Lobby
    if (dom.lobbyUsernameInput) {
      dom.lobbyUsernameInput.addEventListener('input', () => {
        const val = dom.lobbyUsernameInput.value.trim();
        if (val) {
          saveLobbyUsername(val);
        } else if (dom.lobbyUsernameStatus) {
          dom.lobbyUsernameStatus.textContent = '⚠️ Escribe tu nombre antes de entrar';
          dom.lobbyUsernameStatus.className = 'lobby-status-tag is-warning';
        }
      });
      dom.lobbyUsernameInput.addEventListener('blur', () => {
        const val = dom.lobbyUsernameInput.value.trim();
        if (val) saveLobbyUsername(val);
      });
      dom.lobbyUsernameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const val = dom.lobbyUsernameInput.value.trim();
          if (saveLobbyUsername(val)) {
            showToast(`✓ Nombre guardado: ${val}`, 'gold');
          }
        }
      });
    }

    dom.btnSaveLobbyUsername?.addEventListener('click', () => {
      const val = dom.lobbyUsernameInput ? dom.lobbyUsernameInput.value.trim() : '';
      if (saveLobbyUsername(val)) {
        showToast(`✓ Nombre guardado: ${val}`, 'gold');
      } else {
        alert('Por favor escribe tu nombre de jugador.');
        dom.lobbyUsernameInput?.focus();
      }
    });

    // Modificar datos de la sesión (DM en partida)
    dom.btnDmEditSession?.addEventListener('click', () => {
      if (state.partida) {
        openEditGameModal(state.partida);
      }
    });

    // Vista previa al escribir URL de portada en el modal de edición
    dom.editGameImgUrl?.addEventListener('input', () => {
      const url = dom.editGameImgUrl.value.trim();
      if (dom.editGamePreviewImg) {
        if (url) {
          dom.editGamePreviewImg.src = url;
          dom.editGamePreviewImg.style.display = 'block';
        } else {
          dom.editGamePreviewImg.style.display = 'none';
        }
      }
    });

    // Vista previa al seleccionar archivo local de portada
    dom.editGameImgFile?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        const compressed = await compressImageFile(file, 800, 500, 0.82);
        if (dom.editGamePreviewImg && compressed) {
          dom.editGamePreviewImg.src = compressed;
          dom.editGamePreviewImg.style.display = 'block';
        }
      }
    });

    // Envío del formulario de modificación de partida
    dom.formEditGame?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const partidaId = dom.editGameId.value;
      const nuevoNombre = dom.editGameTitle.value.trim();
      if (!partidaId || !nuevoNombre) return;

      let nuevaImagen = dom.editGameImgUrl ? dom.editGameImgUrl.value.trim() : '';
      if (dom.editGameImgFile && dom.editGameImgFile.files && dom.editGameImgFile.files[0]) {
        try {
          const comp = await compressImageFile(dom.editGameImgFile.files[0], 800, 500, 0.82);
          if (comp) nuevaImagen = comp;
        } catch (_) { }
      }

      const usuarioId = localStorage.getItem('vtt_user_id') || state.usuario?.id || '';

      try {
        const res = await fetch(`/api/partidas/${partidaId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nombre: nuevoNombre,
            imagenPortada: nuevaImagen,
            usuarioId
          })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Error al modificar');
        }

        const data = await res.json();

        // Si estamos dentro de esta partida, actualizar títulos y estado
        if (state.partida && state.partida.id === partidaId) {
          state.partida.nombre = data.nombre;
          state.partida.imagen_portada = data.imagen_portada;
          if (dom.navGameTitle) dom.navGameTitle.textContent = data.nombre;
          document.title = `${data.nombre} - VTT D&D 5e`;
        }

        closeModal(dom.modalEditGame);
        showToast('✅ Sesión modificada con éxito', 'success');
        loadGamesList();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    });

    // Eliminar partida desde el modal de edición
    const btnDeleteGameModal = document.getElementById('btn-delete-game-modal');
    if (btnDeleteGameModal) {
      btnDeleteGameModal.addEventListener('click', async () => {
        const partidaId = dom.editGameId?.value;
        const nombrePartida = dom.editGameTitle?.value || 'esta partida';
        if (!partidaId) return;

        if (confirm(`¿Estás seguro de que deseas eliminar definitivamente la partida "${nombrePartida}"?\n\nEsta acción borrará todas sus escenas, fichas y datos guardados de forma permanente.`)) {
          try {
            const res = await fetch(`/api/partidas/${partidaId}`, { method: 'DELETE' });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error || 'Error al eliminar');
            }
            closeModal(dom.modalEditGame);
            showToast('🗑️ Partida eliminada con éxito', 'info');
            if (state.partida && state.partida.id === partidaId) {
              window.location.href = '/';
            } else {
              loadGamesList();
            }
          } catch (err) {
            alert('Error al eliminar la partida: ' + err.message);
          }
        }
      });
    }

    // Eliminar sesión actual desde el Panel del DM
    const btnDmDeleteSession = document.getElementById('btn-dm-delete-session');
    if (btnDmDeleteSession) {
      btnDmDeleteSession.addEventListener('click', async () => {
        if (!state.partida?.id) return;
        const nombrePartida = state.partida.nombre || 'esta sesión';

        if (confirm(`⚠️ ¿ELIMINAR DEFINITIVAMENTE "${nombrePartida.toUpperCase()}"?\n\nEsta acción borrará la sesión entera, las escenas, fichas y desconectará a todos los jugadores.`)) {
          try {
            const res = await fetch(`/api/partidas/${state.partida.id}`, { method: 'DELETE' });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error || 'Error al eliminar');
            }
            alert('La sesión ha sido eliminada con éxito.');
            window.location.href = '/';
          } catch (err) {
            alert('Error al eliminar la sesión: ' + err.message);
          }
        }
      });
    }

    // Herramientas DM (Panel Izquierdo)
    dom.toolButtons?.forEach(btn => {
      btn.addEventListener('click', () => {
        if (!btn.dataset.tool) return;
        dom.toolButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeTool = btn.dataset.tool;

        // Auto-cerrar panel DM en móvil al elegir herramientas directas de mapa
        if (window.innerWidth <= 900 && ['move', 'pan', 'measure', 'erase'].includes(activeTool)) {
          closeAllPanels();
        }

        // Mostrar opciones de sub-herramienta
        dom.toolOptionsContainer?.classList.add('hidden');
        dom.optDraw?.classList.add('hidden');
        dom.optFigures?.classList.add('hidden');
        dom.optProps?.classList.add('hidden');

        if (activeTool === 'draw') {
          dom.toolOptionsContainer?.classList.remove('hidden');
          dom.optDraw?.classList.remove('hidden');
        } else if (activeTool === 'figures') {
          dom.toolOptionsContainer?.classList.remove('hidden');
          dom.optFigures?.classList.remove('hidden');
          if (!selectedFigureId && dom.figLabel) {
            dom.figLabel.value = '';
          }
        } else if (activeTool === 'props') {
          dom.toolOptionsContainer?.classList.remove('hidden');
          dom.optProps?.classList.remove('hidden');
        }
      });
    });

    // Limpiar dibujos
    dom.btnClearDrawings?.addEventListener('click', () => {
      state.dibujos = [];
      markDirty();
      debounceLocalMirrorSave();
      const escenaCur = getEscenaActual();
      if (state.partida?.id && escenaCur?.id) {
        socket?.emit('limpiar_dibujos', { partidaId: state.partida.id, escenaId: escenaCur.id });
      }
    });

    dom.btnClearFigures?.addEventListener('click', () => {
      const escenaCur = getEscenaActual();
      if (!state.partida?.id || !escenaCur?.id) return;
      if (state.usuario.esDM) {
        socket?.emit('limpiar_figuras', { partidaId: state.partida.id, escenaId: escenaCur.id });
      } else {
        socket?.emit('limpiar_mis_figuras', { partidaId: state.partida.id, escenaId: escenaCur.id, usuarioId: state.usuario.id });
      }
    });

    // Actualizar propiedades de figura en tiempo real
    ['figType', 'figSize', 'figHeight', 'figRotation', 'figColor', 'figOpacity', 'figLabel'].forEach(key => {
      if (dom[key]) {
        dom[key].addEventListener('input', () => {
          if (selectedFigureId && activeTool === 'figures') {
            const fig = state.figuras.find(f => f.id === selectedFigureId);
            if (fig && (fig.creador_id === state.usuario.id || state.usuario.esDM)) {
              fig.tipo = dom.figType.value;
              fig.tamanio = parseFloat(dom.figSize.value) || 1;
              fig.ancho = parseFloat(dom.figSize.value) || 1;
              fig.alto = parseFloat(dom.figHeight?.value || dom.figSize.value) || 1;
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
      centerMap();
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
        if (targetPane) {
          targetPane.classList.add('active');
          if (btn.dataset.tab === 'tab-historial') renderHistoryTable();
          if (btn.dataset.tab === 'tab-chat') {
            scrollChatToBottom();
            unreadChatCount = 0;
            if (dom.mbChatUnreadBadge) dom.mbChatUnreadBadge.classList.add('hidden');
          }
        }
      });
    });

    // Fichas
    dom.btnOpenCreateFicha?.addEventListener('click', () => {
      dom.formFicha.reset();
      document.getElementById('ficha-id').value = '';
      dom.fichaImgPreview.src = 'https://via.placeholder.com/100?text=Avatar';
      dom.modalFichaTitle.textContent = 'Crear Nueva Ficha de Personaje';
      populateFichaOwnerSelect('');

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

      updateAllFichaStatMods(true);
      openModal(dom.modalFicha);
    });

    // Actualización en tiempo real de bonificadores de estadísticas (D&D 5e)
    ['ficha-fue', 'ficha-des', 'ficha-con', 'ficha-int', 'ficha-sab', 'ficha-car'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', (e) => {
        updateStatModDisplay(id, 'mod-' + id);
        if (id === 'ficha-des') {
          const iniInput = document.getElementById('ficha-ini');
          const val = parseInt(e.target.value, 10);
          const dexScore = isNaN(val) ? 10 : val;
          const dexMod = Math.floor((dexScore - 10) / 2);
          if (iniInput) iniInput.value = dexMod;
        }
      });
    });

    dom.fichaImgFile?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        const compressed = await compressImageFile(file, 400, 400, 0.85);
        if (dom.fichaImgPreview && compressed) {
          dom.fichaImgPreview.src = compressed;
        }
      }
    });

    dom.fichaImagenUrl?.addEventListener('input', (e) => {
      if (e.target.value) dom.fichaImgPreview.src = e.target.value;
    });

    dom.formFicha?.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = document.getElementById('ficha-id').value;
      const existingFicha = id ? state.fichas.find(f => f.id === id) : null;
      const ownerSelect = dom.fichaJugadorId || document.getElementById('ficha-jugador-id');
      const assignedOwner = ownerSelect ? ownerSelect.value : '';
      let finalJugadorId = null;
      if (state.usuario?.esDM) {
        finalJugadorId = assignedOwner || null;
      } else {
        finalJugadorId = (existingFicha && existingFicha.jugador_id) ? existingFicha.jugador_id : state.usuario?.id;
      }

      const fichaData = {
        id: id || undefined,
        nombre: document.getElementById('ficha-nombre').value,
        tipo: document.getElementById('ficha-tipo').value,
        jugadorId: finalJugadorId,
        jugador_id: finalJugadorId,
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
        notas: document.getElementById('ficha-notas').value,
        revelado: existingFicha ? existingFicha.revelado : undefined,
        gigante: existingFicha ? (existingFicha.gigante ? 1 : 0) : 0,
        oculto: existingFicha ? (existingFicha.oculto ? 1 : 0) : 0
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
    dom.diceTokenSelect?.addEventListener('change', () => {
      const fichaId = dom.diceTokenSelect.value;
      if (fichaId) {
        selectedFichasIds = [fichaId];
      } else {
        selectedFichasIds = [];
      }
      updateMultiSelectBadge();
      updateDiceEffectsBanner();
      renderFichasList();
      markDirty();
    });

    // --- EFECTOS Y CONDICIONES VISUALES (ALPHA) LISTENERS ---
    const btnToggleAlphaEffects = document.getElementById('btn-toggle-alpha-effects');
    btnToggleAlphaEffects?.addEventListener('click', () => {
      state.alphaTokenEffects = !state.alphaTokenEffects;
      localStorage.setItem('vtt_alpha_token_effects', String(state.alphaTokenEffects));
      const chkCanvas = document.getElementById('check-canvas-alpha-effects');
      if (chkCanvas) chkCanvas.checked = state.alphaTokenEffects;
      markDirty();
      showToast(`🏷️ Recuadros de efectos en tokens: ${state.alphaTokenEffects ? 'ACTIVADOS [ALPHA]' : 'DESACTIVADOS'}`, 'gold');
    });

    const chkCanvasAlphaEffects = document.getElementById('check-canvas-alpha-effects');
    chkCanvasAlphaEffects?.addEventListener('change', (e) => {
      state.alphaTokenEffects = e.target.checked;
      localStorage.setItem('vtt_alpha_token_effects', String(state.alphaTokenEffects));
      markDirty();
    });

    const chkDiceAutoEffects = document.getElementById('check-dice-auto-effects');
    chkDiceAutoEffects?.addEventListener('change', (e) => {
      state.autoDiceEffects = e.target.checked;
      localStorage.setItem('vtt_auto_dice_effects', String(state.autoDiceEffects));
      updateDiceEffectsBanner();
      showToast(state.autoDiceEffects ? '⚡ Ajuste automático de dados con efectos ACTIVO' : 'ℹ️ Ajuste de dados con efectos MANUAL (Informativo)', 'info');
    });

    // Pestañas del modal de efectos
    document.querySelectorAll('.btn-effects-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        document.querySelectorAll('.btn-effects-tab').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.effects-tab-content').forEach(c => c.classList.toggle('hidden', c.id !== targetTab));
      });
    });

    // Filtros y búsqueda en catálogo D&D 5e
    let currentCatalogFilterTag = 'todos';
    const inputSearchEffects = document.getElementById('input-search-effects');
    inputSearchEffects?.addEventListener('input', (e) => {
      renderDndConditionsCatalog(e.target.value, currentCatalogFilterTag);
    });

    document.querySelectorAll('.effects-filter-tags .tag-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.effects-filter-tags .tag-filter').forEach(b => b.classList.toggle('active', b === btn));
        currentCatalogFilterTag = btn.dataset.tag || 'todos';
        renderDndConditionsCatalog(inputSearchEffects?.value || '', currentCatalogFilterTag);
      });
    });

    // Iconos rápidos del formulario custom
    document.querySelectorAll('.btn-quick-icon').forEach(btn => {
      btn.addEventListener('click', () => {
        const iconInput = document.getElementById('custom-effect-icon');
        if (iconInput) iconInput.value = btn.textContent.trim();
      });
    });

    // Formulario de creación de efecto personalizado (DM)
    const formCustomEffect = document.getElementById('form-create-custom-effect');
    formCustomEffect?.addEventListener('submit', (e) => {
      e.preventDefault();
      const nameInput = document.getElementById('custom-effect-name');
      const iconInput = document.getElementById('custom-effect-icon');
      const colorInput = document.getElementById('custom-effect-color');
      const modSelect = document.getElementById('custom-effect-dice-mod');
      const durInput = document.getElementById('custom-effect-duration');
      const imgInput = document.getElementById('custom-effect-img-url');
      const descInput = document.getElementById('custom-effect-desc');

      const nombre = nameInput ? nameInput.value.trim() : '';
      if (!nombre) return;

      const efectoNuevo = {
        id: 'cust_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        nombre,
        icono: (iconInput && iconInput.value.trim()) ? iconInput.value.trim() : '✨',
        imagen: (imgInput && imgInput.value.trim()) ? imgInput.value.trim() : '',
        color: (colorInput && colorInput.value) ? colorInput.value : '#ef4444',
        ajusteDado: (modSelect && modSelect.value) ? modSelect.value : 'ninguno',
        tipoDado: 'todos',
        duracion: (durInput && durInput.value.trim()) ? durInput.value.trim() : 'Indefinida',
        descripcion: (descInput && descInput.value.trim()) ? descInput.value.trim() : '',
        origen: 'custom'
      };

      if (currentEditingFichaEffectsId) {
        asignarEfectoAFicha(currentEditingFichaEffectsId, efectoNuevo);
      }

      if (state.usuario?.esDM && state.partida?.id) {
        socket?.emit('guardar_efecto_catalogo', {
          partidaId: state.partida.id,
          efecto: efectoNuevo
        });
      }

      nameInput.value = '';
      if (descInput) descInput.value = '';
      if (imgInput) imgInput.value = '';
      const tabActivosBtn = document.querySelector('.btn-effects-tab[data-tab="tab-active-effects"]');
      if (tabActivosBtn) tabActivosBtn.click();
    });

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
      const escenaCurId = getEscenaActual()?.id || state.escenaActiva?.id;
      if (file && escenaCurId) {
        // Si es GIF animado, preservar datos originales para no perder animación
        if (file.type === 'image/gif') {
          const reader = new FileReader();
          reader.onload = (evt) => {
            socket?.emit('actualizar_mapa', { partidaId: state.partida.id, escenaId: escenaCurId, mapaBase64: evt.target.result });
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
            let resizedBase64 = null;
            try {
              const webpData = canvas.toDataURL('image/webp', 0.82);
              if (webpData && webpData.startsWith('data:image/webp')) {
                resizedBase64 = webpData;
              }
            } catch (_) { }
            if (!resizedBase64) {
              resizedBase64 = canvas.toDataURL('image/jpeg', 0.82);
            }

            socket?.emit('actualizar_mapa', { partidaId: state.partida.id, escenaId: escenaCurId, mapaBase64: resizedBase64 });
          };
          img.src = evt.target.result;
        };
        reader.readAsDataURL(file);
      }
    });

    dom.btnClearMapBg?.addEventListener('click', () => {
      const escenaCurId = getEscenaActual()?.id || state.escenaActiva?.id;
      if (escenaCurId) {
        socket?.emit('actualizar_mapa', { partidaId: state.partida.id, escenaId: escenaCurId, mapaBase64: null });
      }
    });

    dom.btnApplyGrid?.addEventListener('click', () => {
      const escenaCurId = getEscenaActual()?.id || state.escenaActiva?.id;
      const gridX = parseInt(dom.gridColsInput.value) || 40;
      const gridY = parseInt(dom.gridRowsInput.value) || 40;
      const casilla = parseInt(dom.gridFeetInput.value) || 5;

      if (escenaCurId) {
        socket?.emit('actualizar_grid', { partidaId: state.partida.id, escenaId: escenaCurId, gridX, gridY, casilla });
      }
    });

    // Guardar Ficha Actual en Galería de Plantillas
    dom.btnSaveCurrentTemplate?.addEventListener('click', () => {
      let fichaId = dom.selectFichaToTemplate ? dom.selectFichaToTemplate.value : null;
      if (!fichaId && selectedFichasIds.length > 0) {
        fichaId = selectedFichasIds[0];
      }
      if (!fichaId) {
        showToast('Selecciona una ficha en el desplegable o mapa para guardarla como plantilla.', 'warning');
        return;
      }
      const ficha = state.fichas.find(f => f.id === fichaId);
      if (ficha) {
        socket?.emit('guardar_galeria', { partidaId: state.partida.id, nombre: ficha.nombre, datos: ficha });
        showToast(`📚 "${ficha.nombre}" guardada en la galería de plantillas!`, 'success');
      }
    });

    // Apertura del Modal Catálogo Bestiario
    dom.btnQuickGallery?.addEventListener('click', () => {
      openModal(dom.modalDmGallery);
      renderGalleryChips();
    });
    dom.btnOpenGalleryModal?.addEventListener('click', () => {
      openModal(dom.modalDmGallery);
      renderGalleryChips();
    });

    // Buscador en Modal
    dom.inputModalGallerySearch?.addEventListener('input', (e) => {
      galleryFilterText = e.target.value.trim();
      if (dom.btnModalClearSearch) dom.btnModalClearSearch.classList.toggle('hidden', !galleryFilterText);
      renderGalleryChips();
    });
    dom.btnModalClearSearch?.addEventListener('click', () => {
      galleryFilterText = '';
      if (dom.inputModalGallerySearch) dom.inputModalGallerySearch.value = '';
      dom.btnModalClearSearch.classList.add('hidden');
      renderGalleryChips();
    });

    // Chips de Filtro en Modal
    document.querySelectorAll('.catalog-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        galleryFilterType = btn.dataset.filter || 'all';
        document.querySelectorAll('.catalog-filter-btn').forEach(b => {
          b.classList.toggle('active', (b.dataset.filter || 'all') === galleryFilterType);
        });
        renderGalleryChips();
      });
    });

    // Cantidad escrita en Modal
    dom.inputModalSpawnQty?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val) && val > 0) {
        gallerySpawnQuantity = Math.max(1, Math.min(50, val));
        updateSpawnQuantityUI();
      }
    });
    dom.inputModalSpawnQty?.addEventListener('blur', (e) => {
      e.target.value = gallerySpawnQuantity;
    });

    // Cantidad escrita en Modal Inspector Detalle
    dom.inputDetailSpawnQty?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val) && val > 0) {
        gallerySpawnQuantity = Math.max(1, Math.min(50, val));
        updateSpawnQuantityUI();
      }
    });
    dom.inputDetailSpawnQty?.addEventListener('blur', (e) => {
      e.target.value = gallerySpawnQuantity;
    });

    // Botones Stepper + y -
    dom.btnQtyMinus?.addEventListener('click', () => {
      gallerySpawnQuantity = Math.max(1, gallerySpawnQuantity - 1);
      updateSpawnQuantityUI();
    });
    dom.btnQtyPlus?.addEventListener('click', () => {
      gallerySpawnQuantity = Math.min(50, gallerySpawnQuantity + 1);
      updateSpawnQuantityUI();
    });

    // Chips de cantidad rápida (1, 2, 4, 6, 10)
    document.querySelectorAll('.btn-quick-qty').forEach(btn => {
      btn.addEventListener('click', () => {
        gallerySpawnQuantity = parseInt(btn.dataset.qty, 10) || 1;
        updateSpawnQuantityUI();
      });
    });

    // Invocar desde el Inspector de Detalle
    dom.btnSpawnFromDetail?.addEventListener('click', () => {
      if (inspectingTemplateData) {
        spawnFromTemplate(inspectingTemplateData, gallerySpawnQuantity || 1);
        closeModal(dom.modalTemplateDetail);
      }
    });

    // Cerrar Modales
    document.querySelectorAll('.btn-close-modal').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const overlay = e.target.closest('.modal-overlay');
        if (overlay) closeModal(overlay);
      });
    });

    dom.btnRevOcultarTodo?.addEventListener('click', () => {
      if (dom.revImagen) dom.revImagen.checked = false;
      if (dom.revNombre) dom.revNombre.checked = false;
      if (dom.revHpBar) dom.revHpBar.checked = false;
      if (dom.revHp) dom.revHp.checked = false;
      if (dom.revAc) dom.revAc.checked = false;
      if (dom.revNotas) dom.revNotas.checked = false;
    });

    dom.btnRevRevelarTodo?.addEventListener('click', () => {
      if (dom.revImagen) dom.revImagen.checked = true;
      if (dom.revNombre) dom.revNombre.checked = true;
      if (dom.revHpBar) dom.revHpBar.checked = true;
      if (dom.revHp) dom.revHp.checked = true;
      if (dom.revAc) dom.revAc.checked = true;
      if (dom.revNotas) dom.revNotas.checked = true;
    });

    const btnSaveRev = dom.btnSaveRevelar || dom.btnAplicarRevelado;
    btnSaveRev?.addEventListener('click', () => {
      const fichaId = dom.revelarFichaId.value;
      const targetJugador = dom.revJugadoresSelect.value;

      if (!currentFichaReveladoConfig.jugadores) currentFichaReveladoConfig.jugadores = {};

      const newConf = {
        imagen: dom.revImagen.checked,
        nombre: dom.revNombre.checked,
        barra_hp: dom.revHpBar ? dom.revHpBar.checked : dom.revHp.checked,
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

    // --- ACCIONES DEL BANNER DE PREPARACIÓN DE ESCENAS (DM) ---
    dom.btnStagingActivateAll?.addEventListener('click', () => {
      if (state.escenaPreparacion) {
        activarEscenaParaJugadores(state.escenaPreparacion.id);
      }
    });

    dom.btnStagingReturnActive?.addEventListener('click', () => {
      if (state.escenaActiva) {
        cargarEscenaEnModoPreparacion(state.escenaActiva.id);
      }
    });

    // --- REAGRUPAR FICHAS DENTRO DEL MAPA ---
    dom.btnReagruparFichas?.addEventListener('click', () => {
      const escenaCur = getEscenaActual();
      if (!escenaCur || !state.partida?.id) {
        showToast('⚠️ No hay escena activa para reagrupar fichas', 'warning');
        return;
      }
      socket?.emit('reagrupar_fichas', {
        partidaId: state.partida.id,
        escenaId: escenaCur.id
      });
      showToast('📍 Reagrupando fichas de jugadores en el mapa...', 'info');
    });

    // --- EXPERIMENTAL: CAPAS Y OBJETOS (PROPS) ---
    dom.checkExperimentalProps?.addEventListener('change', (e) => {
      toggleExperimentalPropsUI(e.target.checked);
      showToast(e.target.checked ? '✨ Capas y Objetos activado (Experimental)' : 'Capas y Objetos desactivado', 'info');
    });

    const presetMeta = {
      carro: { name: 'Automóvil / Carroza', w: 4, h: 2, layer: 'encima_fichas' },
      arbol: { name: 'Árbol Frondoso', w: 3, h: 3, layer: 'debajo_fichas' },
      cajas: { name: 'Cajas de Suministros', w: 2, h: 2, layer: 'debajo_fichas' },
      mesa: { name: 'Mesa de Taberna', w: 3, h: 2, layer: 'debajo_fichas' },
      sangre: { name: 'Mancha de Sangre', w: 2, h: 2, layer: 'suelo' },
      crater: { name: 'Cráter de Explosión', w: 3, h: 3, layer: 'suelo' },
      carpa: { name: 'Carpa de Campamento', w: 4, h: 4, layer: 'debajo_fichas' },
      puerta: { name: 'Puerta Reforzada', w: 1, h: 2, layer: 'debajo_fichas' }
    };

    // Función unificada para crear y colocar prop en el mapa
    window.crearYColocarProp = function (name, url, w, h, layer, rot = 0) {
      const escenaCur = getEscenaActual();
      if (!escenaCur || !state.partida?.id) {
        showToast('No hay escena disponible para colocar el objeto.', 'warning');
        return;
      }
      if (!url) {
        showToast('Por favor selecciona un diseño o introduce una imagen.', 'warning');
        return;
      }

      let spawnX = 2;
      let spawnY = 2;
      if (canvas) {
        const centerPos = screenToGrid(canvas.width / 2, canvas.height / 2);
        spawnX = Math.max(0, Math.round(centerPos.x - (w || 2) / 2));
        spawnY = Math.max(0, Math.round(centerPos.y - (h || 2) / 2));
      }

      const propData = {
        id: 'prop_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        escena_id: escenaCur.id,
        nombre: name || 'Objeto en Mesa',
        imagen: url,
        x: spawnX,
        y: spawnY,
        ancho: parseFloat(w) || 2,
        alto: parseFloat(h) || 2,
        rotacion: parseInt(rot) || 0,
        capa: layer || 'debajo_fichas',
        bloqueado: 0,
        oculto: 0
      };

      socket?.emit('guardar_prop', {
        partidaId: state.partida.id,
        escenaId: escenaCur.id,
        propData
      });

      selectedPropId = propData.id;
      showToast(`✨ "${propData.nombre}" colocado en el tablero.`, 'success');
      activeTool = 'props';
      dom.toolButtons?.forEach(b => b.classList.toggle('active', b.dataset.tool === 'props'));
      dom.toolOptionsContainer?.classList.remove('hidden');
      dom.optProps?.classList.remove('hidden');
      markDirty();
    };

    // Presets rápidos de objetos (en panel lateral y en barra de herramientas superior)
    document.querySelectorAll('.btn-quick-prop, .btn-prop-preset').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const presetKey = btn.dataset.preset;
        const meta = presetMeta[presetKey] || { name: 'Objeto', w: 2, h: 2, layer: 'debajo_fichas' };
        const name = btn.dataset.name || meta.name;
        const w = parseFloat(btn.dataset.w || meta.w);
        const h = parseFloat(btn.dataset.h || meta.h);
        const layer = btn.dataset.layer || meta.layer;
        const svgUrl = getPropPresetSvg(presetKey);

        if (dom.propNameInput) dom.propNameInput.value = name;
        if (dom.propWidthInput) dom.propWidthInput.value = w;
        if (dom.propHeightInput) dom.propHeightInput.value = h;
        if (dom.propLayerSelect) dom.propLayerSelect.value = layer;
        if (dom.propUrlInput) dom.propUrlInput.value = svgUrl;

        // Colocar directamente en la mesa al hacer clic tanto desde panel como desde toolbar
        window.crearYColocarProp(name, svgUrl, w, h, layer, 0);
      });
    });

    // Botón en toolbar para saltar a los ajustes de capas
    document.getElementById('btn-toolbar-open-props')?.addEventListener('click', () => {
      const dmTabBtn = document.querySelector('.tab-btn[data-tab="tab-dm"]');
      if (dmTabBtn) dmTabBtn.click();
      const propsSec = document.getElementById('dm-props-section');
      if (propsSec) {
        propsSec.classList.remove('hidden');
        propsSec.scrollIntoView({ behavior: 'smooth' });
      }
    });

    // Subida de imagen para prop
    dom.btnPropFileTrigger?.addEventListener('click', () => {
      dom.propFileInput?.click();
    });

    dom.propFileInput?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        if (dom.propUrlInput) dom.propUrlInput.value = dataUrl;
        if (dom.propNameInput && !dom.propNameInput.value) {
          dom.propNameInput.value = file.name.replace(/\.[^/.]+$/, '');
        }
        showToast('Imagen del objeto cargada correctamente.', 'info');
      } catch (err) {
        showToast('Error al leer el archivo de imagen', 'danger');
      }
    });

    // Guardar / Colocar Prop desde el formulario
    dom.btnAddPropSubmit?.addEventListener('click', () => {
      const name = (dom.propNameInput?.value || '').trim() || 'Objeto en Mesa';
      const url = (dom.propUrlInput?.value || '').trim();
      const w = Math.max(0.5, parseFloat(dom.propWidthInput?.value) || 2);
      const h = Math.max(0.5, parseFloat(dom.propHeightInput?.value) || 2);
      const rot = parseInt(dom.propRotInput?.value) || 0;
      const layer = dom.propLayerSelect?.value || 'debajo_fichas';

      if (!url) {
        showToast('Por favor selecciona un preset o introduce una imagen/URL.', 'warning');
        return;
      }

      window.crearYColocarProp(name, url, w, h, layer, rot);
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

    // Determinar la ficha objetivo para animación y lectura de efectos
    const targetTokenId = fichaId || (selectedFichasIds && selectedFichasIds[0]) || dom.diceTokenSelect?.value || '';
    const targetFicha = targetTokenId ? (state.fichas || []).find(f => f.id === targetTokenId) : null;
    const targetNombre = targetFicha ? targetFicha.nombre : '';

    // Detección de efectos activos en la criatura para ajuste de dados [ALPHA]
    let efectosFicha = [];
    if (targetFicha?.efectos) {
      if (Array.isArray(targetFicha.efectos)) efectosFicha = targetFicha.efectos;
      else if (typeof targetFicha.efectos === 'string' && targetFicha.efectos.trim()) {
        try { efectosFicha = JSON.parse(targetFicha.efectos); } catch (_) {}
      }
    }

    let finalMode = mode;
    const effectNotes = [];
    const autoEffects = state.autoDiceEffects !== false;

    if (efectosFicha.length > 0) {
      const hasDesv = efectosFicha.some(e => e.ajusteDado === 'desventaja');
      const hasVent = efectosFicha.some(e => e.ajusteDado === 'ventaja');
      const hasBless = efectosFicha.some(e => e.ajusteDado === '+1d4');
      const hasBane = efectosFicha.some(e => e.ajusteDado === '-1d4');
      const hasPlus2 = efectosFicha.some(e => e.ajusteDado === '+2');
      const hasMinus2 = efectosFicha.some(e => e.ajusteDado === '-2');

      if (autoEffects && !isDamageOrHeal) {
        if (hasDesv && finalMode === 'normal') {
          finalMode = 'desventaja';
          effectNotes.push('Desventaja auto');
        }
        if (hasVent && finalMode === 'normal') {
          finalMode = 'ventaja';
          effectNotes.push('Ventaja auto');
        }
        if (hasBless) {
          rawFormula += '+1d4';
          effectNotes.push('+1d4 Bendición');
        }
        if (hasBane) {
          rawFormula += '-1d4';
          effectNotes.push('-1d4 Perdición');
        }
        if (hasPlus2) {
          rawFormula += '+2';
          effectNotes.push('+2 Bono');
        }
        if (hasMinus2) {
          rawFormula += '-2';
          effectNotes.push('-2 Penalizador');
        }
      } else if (!autoEffects) {
        // Notificar al usuario lo que debe hacer según la regla si eligió modo manual
        const nombresConEfecto = efectosFicha.filter(e => e.ajusteDado && e.ajusteDado !== 'ninguno');
        if (nombresConEfecto.length > 0) {
          const detalle = nombresConEfecto.map(e => `${e.icono || ''}${e.nombre}: ${e.ajusteDado}`).join(' | ');
          effectNotes.push(`Regla: ${detalle}`);
          showToast(`ℹ️ Efectos en ${targetFicha.nombre}: ${detalle}. Aplica el botón si deseas ajustarlo.`, 'info');
        }
      }
    }

    try {
      if (!isDamageOrHeal) {
        if (finalMode === 'ventaja') {
          rawFormula = rawFormula.replace(/1d20/g, '2d20kh1');
        } else if (finalMode === 'desventaja') {
          rawFormula = rawFormula.replace(/1d20/g, '2d20kl1');
        }
      }

      const diceResult = evalDiceFormula(rawFormula);
      finalResult = diceResult.total;

      // Construir texto de fórmula con detalle de dados
      let formulaDisplay = originalFormula;
      if (!isDamageOrHeal && finalMode !== 'normal' && diceResult.rollDetails.length > 0) {
        const modeLabel = finalMode === 'ventaja' ? '⭐Ventaja' : '🌑Desventaja';
        formulaDisplay = `${originalFormula} [${modeLabel}: ${diceResult.rollDetails.join(', ')}]`;
      } else if (diceResult.rollDetails.length > 0) {
        formulaDisplay = `${originalFormula} [${diceResult.rollDetails.join(', ')}]`;
      }

      if (effectNotes.length > 0) {
        formulaDisplay += ` [⚡${effectNotes.join(' - ')}]`;
      }

      socket?.emit('lanzar_dados', {
        partidaId: state.partida.id,
        usuarioId: state.usuario.id,
        nombreUsuario: state.usuario.nombre,
        formula: formulaDisplay,
        tipo: classif,
        resultado: finalResult,
        fichaId: targetTokenId || fichaId,
        fichaNombre: targetNombre,
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
    const fichaBadge = msg.nombre_ficha ? ` <span class="chat-token-badge" title="Tirada asociada a ${msg.nombre_ficha}">[🎯 ${msg.nombre_ficha}]</span>` : '';
    senderSpan.innerHTML = `${msg.nombre_usuario}${fichaBadge}: `;
    senderSpan.style.cursor = 'pointer';
    senderSpan.title = msg.nombre_ficha ? `Haz clic para centrar mapa en ficha ${msg.nombre_ficha}` : 'Haz clic para centrar mapa en ficha de este jugador';
    senderSpan.addEventListener('click', () => {
      if (msg.nombre_ficha) {
        centerOnPlayerToken(msg.nombre_ficha);
      } else {
        centerOnPlayerToken(msg.nombre_usuario);
      }
    });

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
    if (!username) return;
    const target = username.toLowerCase().trim();
    const ficha = (state.fichas || []).find(f => {
      const fName = (f.nombre || '').toLowerCase().trim();
      const fJugadorId = (f.jugador_id || '').toLowerCase().trim();
      return fName === target || fJugadorId === target || fJugadorId === 'usr_' + target.replace(/[^a-z0-9]/g, '_');
    });
    if (ficha && canvas) {
      const tileSize = getTileSize();
      viewport.panX = canvas.width / 2 - (ficha.x * tileSize);
      viewport.panY = canvas.height / 2 - (ficha.y * tileSize);
      selectedFichasIds = [ficha.id];
      markDirty();
      if (window.innerWidth <= 900) {
        closeAllPanels();
      }
    }
  }

  function centerOnToken(fichaId) {
    const ficha = (state.fichas || []).find(f => f.id === fichaId);
    if (ficha && canvas) {
      const tileSize = getTileSize();
      viewport.panX = canvas.width / 2 - (ficha.x * tileSize);
      viewport.panY = canvas.height / 2 - (ficha.y * tileSize);
      selectedFichasIds = [ficha.id];
      markDirty();
      if (window.innerWidth <= 900) {
        closeAllPanels();
      }
    }
  }

  function scrollChatToBottom() {
    dom.chatMessagesContainer.scrollTop = dom.chatMessagesContainer.scrollHeight;
  }

  // --- COMBAT & TURN TRACKER ENGINE ---

  function renderCombatTracker() {
    if (!dom.combatTrackerBar) return;

    const combate = state.combate;
    if (!combate || !combate.activo || !combate.participantes || combate.participantes.length === 0) {
      dom.combatTrackerBar.classList.add('hidden');
      if (dom.mbCombatBadge) dom.mbCombatBadge.classList.add('hidden');
      if (dom.mbCombatText) dom.mbCombatText.textContent = 'Combate';
      if (dom.mbBtnCombat) dom.mbBtnCombat.classList.remove('highlight');
      return;
    }

    dom.combatTrackerBar.classList.remove('hidden');
    if (dom.combatRoundText) {
      dom.combatRoundText.textContent = `Ronda ${combate.ronda || 1}`;
    }

    const currentTurnIndex = combate.turnoIndex || 0;
    const activeParticipant = combate.participantes[currentTurnIndex];
    if (dom.combatActiveName) {
      if (activeParticipant) {
        const isMonsterAct = (activeParticipant.tipo || 'jugador').toLowerCase() !== 'jugador';
        const visAct = getFichaVisibility(activeParticipant);
        const nameAct = (isMonsterAct && !state.usuario?.esDM && !visAct.nombre) ? 'Desconocido' : activeParticipant.nombre;
        dom.combatActiveName.textContent = nameAct;
      } else {
        dom.combatActiveName.textContent = 'Nadie';
      }
    }

    // Botón "Terminar Mi Turno" para el jugador dueño
    if (dom.btnPlayerEndTurn) {
      const isMyTurn = activeParticipant && state.usuario?.id && (activeParticipant.jugador_id === state.usuario.id);
      if (isMyTurn) {
        dom.btnPlayerEndTurn.classList.remove('hidden');
      } else {
        dom.btnPlayerEndTurn.classList.add('hidden');
      }
    }

    // Actualizar botón de combate en el mobile dock
    if (dom.mbBtnCombat) {
      if (dom.mbCombatBadge) {
        dom.mbCombatBadge.classList.remove('hidden');
        dom.mbCombatBadge.textContent = `R${combate.ronda || 1}`;
      }
      const isMyTurn = activeParticipant && state.usuario?.id && (activeParticipant.jugador_id === state.usuario.id);
      if (isMyTurn) {
        dom.mbBtnCombat.classList.add('highlight');
        if (dom.mbCombatText) dom.mbCombatText.textContent = '¡Tu Turno!';
      } else {
        dom.mbBtnCombat.classList.remove('highlight');
        if (dom.mbCombatText) dom.mbCombatText.textContent = `Ronda ${combate.ronda || 1}`;
      }
    }

    // Renderizar la tira horizontal de combatientes
    if (dom.combatTrackList) {
      dom.combatTrackList.innerHTML = '';
      combate.participantes.forEach((p, idx) => {
        const isMonster = (p.tipo || 'jugador').toLowerCase() !== 'jugador';
        const pVis = getFichaVisibility(p);
        const isPlayerView = !state.usuario?.esDM;
        const pName = (isMonster && isPlayerView && !pVis.nombre) ? 'Desconocido' : p.nombre;
        const showAvatar = (!isMonster || !isPlayerView || pVis.imagen);

        const card = document.createElement('div');
        const isActive = idx === currentTurnIndex;
        card.className = `combat-participant-card ${isActive ? 'active' : ''} ${p.hp_actual <= 0 ? 'combat-card-dead' : ''}`;
        card.title = `${pName} (Iniciativa: ${p.iniciativa ?? 0})${isActive ? ' - ¡En Turno!' : ''}\nHaz clic para centrar en el mapa`;

        // Avatar
        let avatarEl;
        if (showAvatar && p.imagen) {
          avatarEl = document.createElement('img');
          avatarEl.src = p.imagen;
          avatarEl.className = 'combat-card-avatar';
          avatarEl.alt = pName;
        } else {
          avatarEl = document.createElement('div');
          avatarEl.className = 'combat-card-avatar';
          avatarEl.textContent = (pName || '?')[0].toUpperCase();
        }

        // Meta info
        const metaEl = document.createElement('div');
        metaEl.className = 'combat-card-meta';

        const nameEl = document.createElement('span');
        nameEl.className = 'combat-card-name';
        nameEl.textContent = pName;

        const iniEl = document.createElement('span');
        iniEl.className = 'combat-card-ini';
        iniEl.textContent = `⚡ ${p.iniciativa ?? 0}`;

        metaEl.appendChild(nameEl);
        metaEl.appendChild(iniEl);

        card.appendChild(avatarEl);
        card.appendChild(metaEl);

        // Botón para que el DM pueda remover un participante de la ronda si se retira o muere
        if (state.usuario?.esDM) {
          const btnRemove = document.createElement('button');
          btnRemove.className = 'combat-card-remove';
          btnRemove.innerHTML = '<i class="fa-solid fa-xmark"></i>';
          btnRemove.title = `Quitar a ${pName} del combate`;
          btnRemove.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`¿Quitar a "${p.nombre}" de la ronda de combate?`)) {
              if (state.partida?.id) {
                socket.emit('quitar_participante_combate', { partidaId: state.partida.id, fichaId: p.id });
              }
            }
          });
          card.appendChild(btnRemove);
        }

        card.addEventListener('click', () => {
          centerOnToken(p.id);
        });

        dom.combatTrackList.appendChild(card);

        // Desplazar automáticamente para que el turno activo esté centrado
        if (isActive) {
          setTimeout(() => {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
          }, 50);
        }
      });
    }
  }

  function openCombatSetupModal(isAddingMode = false) {
    if (!state.usuario?.esDM) {
      alert('Solo el Dungeon Master puede preparar e iniciar el combate.');
      return;
    }

    if (!dom.combatSetupTbody) return;
    dom.combatSetupTbody.innerHTML = '';

    const isCombatActive = Boolean(state.combate?.activo);
    const modeAdding = isAddingMode || isCombatActive;

    if (dom.combatSetupTitleText) {
      dom.combatSetupTitleText.textContent = modeAdding
        ? `Gestión de Combate — Ronda ${state.combate?.ronda || 1} en Curso`
        : 'Preparación de Combate';
    }

    if (dom.btnCombatAddConfirm) {
      if (modeAdding) {
        dom.btnCombatAddConfirm.classList.remove('hidden');
        if (dom.btnCombatStartConfirm) {
          dom.btnCombatStartConfirm.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Reiniciar Combate';
          dom.btnCombatStartConfirm.className = 'btn btn-secondary';
        }
      } else {
        dom.btnCombatAddConfirm.classList.add('hidden');
        if (dom.btnCombatStartConfirm) {
          dom.btnCombatStartConfirm.innerHTML = '<i class="fa-solid fa-play"></i> ¡Comenzar Combate!';
          dom.btnCombatStartConfirm.className = 'btn btn-gold';
        }
      }
    }

    // Obtener fichas de la escena activa (o todos los jugadores y criaturas de esta escena)
    const escenaId = state.escenaActiva?.id;
    const tokensDisponibles = (state.fichas || []).filter(f => f.tipo === 'jugador' || f.escena_id === escenaId);

    if (tokensDisponibles.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">No hay fichas en esta escena para gestionar combate.</td>`;
      dom.combatSetupTbody.appendChild(tr);
      openModal(dom.modalCombatSetup);
      return;
    }

    const participantesActualesIds = new Set((state.combate?.participantes || []).map(p => p.id));

    tokensDisponibles.forEach(f => {
      const tr = document.createElement('tr');
      tr.dataset.fichaId = f.id;
      const alreadyIn = modeAdding && participantesActualesIds.has(f.id);
      if (alreadyIn) tr.dataset.alreadyIn = '1';

      // Calcular modificador de destreza
      const dexMod = Math.floor(((f.destreza ?? 10) - 10) / 2);
      let iniBase;
      if (alreadyIn) {
        const pCurrent = state.combate.participantes.find(p => p.id === f.id);
        iniBase = pCurrent?.iniciativa ?? (f.iniciativa || (10 + dexMod));
      } else {
        iniBase = (f.iniciativa !== undefined && f.iniciativa !== null && f.iniciativa !== 0) ? f.iniciativa : (10 + dexMod);
      }

      const avatarHtml = f.imagen
        ? `<img src="${f.imagen}" class="combat-setup-avatar" alt="${f.nombre}">`
        : `<div class="combat-setup-avatar" style="display:flex;align-items:center;justify-content:center;color:var(--gold-light);">${(f.nombre || '?')[0].toUpperCase()}</div>`;

      const checkDisabled = alreadyIn ? 'disabled' : '';
      const checkChecked = alreadyIn ? 'checked' : 'checked';
      const badgeInCombat = alreadyIn ? ' <span class="combat-badge-in-fight">En Combate</span>' : '';

      tr.innerHTML = `
        <td style="text-align: center;"><input type="checkbox" class="combat-token-check" ${checkChecked} ${checkDisabled} data-ficha-id="${f.id}"></td>
        <td>${avatarHtml}</td>
        <td><strong>${f.nombre}</strong>${badgeInCombat}</td>
        <td><span class="badge-tag tag-${f.tipo || 'jugador'}">${f.tipo === 'jugador' ? 'Jugador' : (f.tipo === 'npc' ? 'NPC' : 'Monstruo')}</span></td>
        <td><input type="number" class="combat-setup-ini-input" data-ficha-id="${f.id}" data-dex-mod="${dexMod}" value="${iniBase}" ${alreadyIn ? 'disabled' : ''}></td>
      `;

      dom.combatSetupTbody.appendChild(tr);
    });

    if (dom.combatSelectMaster) dom.combatSelectMaster.checked = true;
    openModal(dom.modalCombatSetup);
  }

  function rollAllCombatInitiatives() {
    if (!dom.combatSetupTbody) return;
    const inputs = dom.combatSetupTbody.querySelectorAll('.combat-setup-ini-input:not(:disabled)');
    inputs.forEach(input => {
      const dexMod = parseInt(input.dataset.dexMod, 10) || 0;
      const d20 = Math.floor(Math.random() * 20) + 1;
      input.value = d20 + dexMod;
    });
  }

  function confirmAddParticipantsToCombat() {
    if (!state.partida?.id) return;
    if (!dom.combatSetupTbody) return;

    // Obtener los tokens marcados que NO estaban ya en combate
    const checks = dom.combatSetupTbody.querySelectorAll('.combat-token-check:checked:not(:disabled)');
    if (checks.length === 0) {
      alert('Selecciona al menos un participante nuevo para agregar a la ronda.');
      return;
    }

    const nuevosParticipantes = [];
    checks.forEach(chk => {
      const fichaId = chk.dataset.fichaId;
      const ficha = (state.fichas || []).find(f => f.id === fichaId);
      const iniInput = dom.combatSetupTbody.querySelector(`.combat-setup-ini-input[data-ficha-id="${fichaId}"]`);
      const iniciativa = parseInt(iniInput?.value, 10) || 0;

      if (ficha) {
        nuevosParticipantes.push({
          id: ficha.id,
          nombre: ficha.nombre,
          tipo: ficha.tipo,
          imagen: ficha.imagen,
          jugador_id: ficha.jugador_id,
          destreza: ficha.destreza || 10,
          iniciativa: iniciativa,
          hp_actual: ficha.hp_actual ?? 10,
          hp_maximo: ficha.hp_maximo ?? 10,
          ac: ficha.ac ?? 10
        });
      }
    });

    socket.emit('agregar_participantes_combate', {
      partidaId: state.partida.id,
      nuevosParticipantes
    });

    closeModal(dom.modalCombatSetup);
    showToast(`⚔️ ${nuevosParticipantes.length} participante(s) incorporado(s) a la ronda actual`, 'gold');
  }

  function confirmStartCombat() {
    if (!dom.combatSetupTbody) return;
    const checks = dom.combatSetupTbody.querySelectorAll('.combat-token-check:checked');
    if (checks.length === 0) {
      alert('Debes seleccionar al menos un participante para iniciar el combate.');
      return;
    }

    const participantes = [];
    checks.forEach(chk => {
      const fichaId = chk.dataset.fichaId;
      const ficha = (state.fichas || []).find(f => f.id === fichaId);
      const iniInput = dom.combatSetupTbody.querySelector(`.combat-setup-ini-input[data-ficha-id="${fichaId}"]`);
      const iniciativa = parseInt(iniInput?.value, 10) || 0;

      if (ficha) {
        participantes.push({
          id: ficha.id,
          nombre: ficha.nombre,
          tipo: ficha.tipo,
          imagen: ficha.imagen,
          jugador_id: ficha.jugador_id,
          destreza: ficha.destreza || 10,
          iniciativa: iniciativa,
          hp_actual: ficha.hp_actual ?? 10,
          hp_maximo: ficha.hp_maximo ?? 10,
          ac: ficha.ac ?? 10
        });
      }
    });

    socket.emit('iniciar_combate', {
      partidaId: state.partida.id,
      participantes
    });

    closeModal(dom.modalCombatSetup);
  }

  // --- RENDERIZADO DE LISTAS E INTERFAZ ---

  function updateUIForCurrentGame() {
    if (!state.partida) return;
    const nombreLimpio = limpiarNombrePartida(state.partida.nombre);
    state.partida.nombre = nombreLimpio;
    if (dom.navGameTitle) dom.navGameTitle.textContent = nombreLimpio;
    document.title = `${nombreLimpio} - VTT D&D 5e`;
    if (dom.currentRoomCode) dom.currentRoomCode.textContent = state.partida.codigo;
    if (dom.currentSceneName) dom.currentSceneName.textContent = state.escenaActiva?.nombre || 'Escena';

    if (state.usuario?.esDM) {
      if (dom.userRoleBadge) dom.userRoleBadge.className = 'role-badge dm clickable';
      if (dom.userRoleText) dom.userRoleText.textContent = `DM: ${state.usuario.nombre || 'Dungeon Master'}`;
      document.querySelectorAll('.dm-only').forEach(el => el.classList.remove('hidden'));
      if (dom.bannerPlayerClaimDm) dom.bannerPlayerClaimDm.classList.add('hidden');
      if (dom.btnReclamarDm) dom.btnReclamarDm.parentElement.classList.add('hidden');
    } else {
      if (dom.userRoleBadge) dom.userRoleBadge.className = 'role-badge clickable';
      if (dom.userRoleText) dom.userRoleText.textContent = state.usuario?.nombre || 'Jugador';
      document.querySelectorAll('.dm-only').forEach(el => el.classList.add('hidden'));
      if (dom.bannerPlayerClaimDm) dom.bannerPlayerClaimDm.classList.remove('hidden');
      if (dom.btnReclamarDm) dom.btnReclamarDm.parentElement.classList.remove('hidden');
    }

    if (dom.gridColsInput) dom.gridColsInput.value = state.escenaActiva?.config_grid_x || state.partida.config_grid_x || 40;
    if (dom.gridRowsInput) dom.gridRowsInput.value = state.escenaActiva?.config_grid_y || state.partida.config_grid_y || 40;
    if (dom.gridFeetInput) dom.gridFeetInput.value = state.escenaActiva?.config_casilla || state.partida.config_casilla || 5;

    try { renderCombatTracker(); } catch (e) { console.error('[VTT] Error renderCombatTracker:', e); }
    try { renderFichasList(); } catch (e) { console.error('[VTT] Error renderFichasList:', e); }
    try { renderTokenSelects(); } catch (e) { console.error('[VTT] Error renderTokenSelects:', e); }
    try { renderScenesList(); } catch (e) { console.error('[VTT] Error renderScenesList:', e); }
    try { renderGalleryChips(); } catch (e) { console.error('[VTT] Error renderGalleryChips:', e); }
    try { renderChatMessages(); } catch (e) { console.error('[VTT] Error renderChatMessages:', e); }
    try { renderHistoryTable(); } catch (e) { console.error('[VTT] Error renderHistoryTable:', e); }
    try { renderQuickHistory(); } catch (e) { console.error('[VTT] Error renderQuickHistory:', e); }
    try { renderDmPlayersList(); } catch (e) { console.error('[VTT] Error renderDmPlayersList:', e); }
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

  let renderFichasRaf = false;
  function renderFichasList() {
    if (renderFichasRaf) return;
    renderFichasRaf = true;
    requestAnimationFrame(() => {
      renderFichasRaf = false;
      renderFichasListInternal();
    });
  }

  function renderFichasListInternal() {
    if (!dom.fichasList) return;
    dom.fichasList.innerHTML = '';
    const filter = (dom.filterFichasInput?.value || '').toLowerCase();

    const escenaActualId = getEscenaActual()?.id;
    let listToRender = [...(state.fichas || [])].filter(f => {
      const tipo = (f.tipo || 'jugador').toLowerCase();
      if (tipo === 'jugador') return true;
      if (!escenaActualId) return true;
      return String(f.escena_id) === String(escenaActualId);
    });
    // Filtrar fichas ocultas para jugadores
    if (!state.usuario?.esDM) {
      listToRender = listToRender.filter(f => !f.oculto || esDuenioDeFicha(f));
    }

    if (sortInitiative) {
      listToRender.sort((a, b) => (b.iniciativa || 0) - (a.iniciativa || 0));
    }

    // Si sortInitiative está activo, asegurar que el botón se vea activo
    if (dom.btnSortInitiative) {
      dom.btnSortInitiative.classList.toggle('active', sortInitiative);
    }

    const fragment = document.createDocumentFragment();

    listToRender.forEach(ficha => {
      if (filter && !ficha.nombre.toLowerCase().includes(filter)) return;

      const card = document.createElement('div');
      card.className = `ficha-card ${selectedFichasIds.includes(ficha.id) ? 'selected' : ''} ${ficha.oculto ? 'ficha-oculta' : ''}`;

      const tipoStr = (ficha.tipo || 'jugador').toLowerCase();
      const isMonster = tipoStr === 'monstruo' || tipoStr === 'npc';
      const isPlayerView = !state.usuario?.esDM;
      const visibility = getFichaVisibility(ficha);

      const displayName = (isMonster && isPlayerView && !visibility.nombre) ? 'Desconocido' : ficha.nombre;
      const showCardHpBar = (!isMonster || !isPlayerView || visibility.barra_hp);
      const hpText = (isMonster && isPlayerView && !visibility.hp) ? null : `${ficha.hp_actual}/${ficha.hp_maximo}`;
      const acText = (isMonster && isPlayerView && !visibility.ac) ? null : ficha.ac;
      const iniText = ficha.iniciativa || 0;
      const avatarSrc = (isMonster && isPlayerView && !visibility.imagen) ? 'https://via.placeholder.com/48?text=?' : (ficha.imagen || 'https://via.placeholder.com/48?text=Avatar');

      const subParts = [tipoStr.toUpperCase()];
      if (hpText !== null) subParts.push(`HP: ${hpText}`);
      if (acText !== null) subParts.push(`AC: ${acText}`);
      subParts.push(`INI: <strong class="gold-text">${iniText}</strong>`);
      const subInfoText = subParts.join(' | ');

      const hpBarHtml = showCardHpBar ? `
        <div class="hp-bar-outer">
          <div class="hp-bar-inner" style="width: ${Math.max(0, Math.min(100, (ficha.hp_actual / (ficha.hp_maximo || 1)) * 100))}%"></div>
        </div>
      ` : '';

      const esPropietario = esDuenioDeFicha(ficha);
      const ocultoBadge = (state.usuario?.esDM && ficha.oculto) ? `<span style="background:#555; color:#f87171; font-size:0.75rem; padding:2px 6px; border-radius:4px; margin-left:6px;"><i class="fa-solid fa-eye-slash"></i> Oculto</span>` : '';

      const showNotas = state.usuario.esDM || !isMonster || visibility.notas;
      const tieneNotasVisibles = showNotas && !!(ficha.notas && ficha.notas.trim() !== '');

      const isCombatActive = Boolean(state.combate?.activo);
      const estaEnCombate = isCombatActive && (state.combate?.participantes || []).some(p => p.id === ficha.id);
      const btnAddCombatHtml = (state.usuario?.esDM && isCombatActive && !estaEnCombate)
        ? `<button class="btn btn-sm btn-quick-add-combat" title="Incorporar este personaje/criatura a la ronda de combate activa"><i class="fa-solid fa-swords"></i> +Ronda</button>`
        : '';

      card.innerHTML = `
        <div class="ficha-card-header">
          <img src="${avatarSrc}" class="ficha-avatar" style="cursor: pointer;" title="Haz clic para ampliar">
          <div class="ficha-info">
            <div class="ficha-name">${displayName} ${ocultoBadge}</div>
            <div class="ficha-sub">${subInfoText}</div>
            ${hpBarHtml}
            ${renderFichaEffectsHtml(ficha)}
          </div>
        </div>
        <div class="ficha-actions">
          <button class="btn btn-sm btn-secondary btn-center-ficha" title="Centrar cámara en esta ficha"><i class="fa-solid fa-crosshairs"></i></button>
          <button class="btn btn-sm btn-secondary btn-manage-effects" title="Gestionar Estados y Efectos [ALPHA]"><i class="fa-solid fa-sparkles gold-text"></i> Estados</button>
          ${btnAddCombatHtml}
          ${tieneNotasVisibles ? `<button class="btn btn-sm btn-secondary btn-ver-notas" title="Ver rasgos, hechizos y notas"><i class="fa-solid fa-scroll gold-text"></i> Notas</button>` : ''}
          ${esPropietario ? `<button class="btn btn-sm ${ficha.gigante ? 'btn-gold' : 'btn-secondary'} btn-gigante" title="${ficha.gigante ? 'Volver a tamaño normal' : 'Aumentar a tamaño gigante'}"><i class="fa-solid fa-up-right-and-down-left-from-center"></i> ${ficha.gigante ? 'Normal' : 'Gigante'}</button>` : ''}
          ${state.usuario.esDM ? `<button class="btn btn-sm ${ficha.oculto ? 'btn-warning' : 'btn-secondary'} btn-toggle-oculto" title="${ficha.oculto ? 'Mostrar en mapa a jugadores' : 'Ocultar en mapa a jugadores'}"><i class="fa-solid ${ficha.oculto ? 'fa-eye' : 'fa-eye-slash'}"></i> ${ficha.oculto ? 'Mostrar' : 'Ocultar'}</button>` : ''}
          ${state.usuario.esDM && isMonster ? `<button class="btn btn-sm btn-primary btn-revelar-menu" title="Configurar visibilidad de datos para jugadores"><i class="fa-solid fa-eye"></i> Visibilidad</button>` : ''}
          ${esPropietario ? '<button class="btn btn-sm btn-primary btn-edit-ficha" title="Editar ficha"><i class="fa-solid fa-pen"></i> Editar</button>' : ''}
          ${(state.usuario.esDM || esPropietario) ? '<button class="btn btn-sm btn-danger btn-del-ficha" title="Eliminar ficha"><i class="fa-solid fa-trash"></i></button>' : ''}
        </div>
      `;

      card.querySelector('.btn-quick-add-combat')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const dexMod = Math.floor(((ficha.destreza ?? 10) - 10) / 2);
        const rolledIni = (Math.floor(Math.random() * 20) + 1) + dexMod;
        const baseIni = (ficha.iniciativa !== undefined && ficha.iniciativa !== null && ficha.iniciativa !== 0) ? ficha.iniciativa : rolledIni;
        const inputIni = prompt(`Iniciativa para incorporar a "${ficha.nombre}" a la ronda ${state.combate?.ronda || 1} (d20+DES=${dexMod}):`, baseIni);
        if (inputIni === null) return;
        const finalIniciativa = parseInt(inputIni, 10) || 0;

        const nuevoParticipante = {
          id: ficha.id,
          nombre: ficha.nombre,
          tipo: ficha.tipo,
          imagen: ficha.imagen,
          jugador_id: ficha.jugador_id,
          destreza: ficha.destreza || 10,
          iniciativa: finalIniciativa,
          hp_actual: ficha.hp_actual ?? 10,
          hp_maximo: ficha.hp_maximo ?? 10,
          ac: ficha.ac ?? 10
        };

        socket?.emit('agregar_participantes_combate', {
          partidaId: state.partida.id,
          nuevosParticipantes: [nuevoParticipante]
        });
        showToast(`⚔️ "${ficha.nombre}" incorporado a la ronda de combate`, 'gold');
      });

      card.querySelector('.btn-center-ficha')?.addEventListener('click', (e) => {
        e.stopPropagation();
        centerOnToken(ficha.id);
      });

      card.querySelector('.btn-manage-effects')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openModalFichaEfectos(ficha.id);
      });

      card.querySelectorAll('.btn-remove-effect')?.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const efectoId = btn.dataset.efectoId;
          const fId = btn.dataset.fichaId;
          if (fId && efectoId) removerEfectoDeFicha(fId, efectoId);
        });
      });

      function abrirModalNotas() {
        dom.enlargedGifImg.src = avatarSrc;
        if (dom.enlargedImgTitle) {
          dom.enlargedImgTitle.textContent = displayName;
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
      }

      const avatarImg = card.querySelector('.ficha-avatar');
      if (avatarImg) {
        avatarImg.addEventListener('click', abrirModalNotas);
      }

      card.querySelector('.btn-ver-notas')?.addEventListener('click', abrirModalNotas);

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
          populateFichaOwnerSelect(ficha.jugador_id);
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
          const tVal = (ficha.tamanio_base || 'mediano').toLowerCase();
          document.getElementById('ficha-tamanio').value = (tVal === 'supergargantura') ? 'supergargantua' : ((tVal === 'ultra gargantua' || tVal === 'ultra-gargantua' || tVal === 'ultragargantura') ? 'ultragargantua' : tVal);
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

          updateAllFichaStatMods(false);
          openModal(dom.modalFicha);
        });
      }

      if (state.usuario.esDM && isMonster) {
        card.querySelector('.btn-revelar-menu')?.addEventListener('click', () => {
          abrirMenuRevelado(ficha);
        });
      }

      if (state.usuario.esDM || esPropietario) {
        card.querySelector('.btn-del-ficha')?.addEventListener('click', () => {
          if (confirm(`¿Eliminar la ficha de ${ficha.nombre}?`)) {
            socket?.emit('eliminar_ficha', { partidaId: state.partida.id, fichaId: ficha.id });
          }
        });
      }

      card.addEventListener('click', (e) => {
        if (e.target.closest('button') || e.target.closest('img')) return;

        // Si no es DM y la ficha no es suya, no permitir seleccionarla para mover
        if (!state.usuario?.esDM && !esDuenioDeFicha(ficha)) {
          if (dom.diceTokenSelect) {
            dom.diceTokenSelect.value = ficha.id;
          }
          return;
        }

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

        if (!state.usuario?.esDM) {
          selectedFichasIds = selectedFichasIds.filter(id => {
            const f = (state.fichas || []).find(fi => fi.id === id);
            return f && esDuenioDeFicha(f);
          });
        }

        updateMultiSelectBadge();
        if (dom.diceTokenSelect) {
          dom.diceTokenSelect.value = selectedFichasIds[0] || '';
          if (selectedFichasIds[0] && dom.diceTokenSelect.selectedIndex <= 0) {
            renderTokenSelects();
            dom.diceTokenSelect.value = selectedFichasIds[0];
          }
        }
        updateDiceEffectsBanner();
        if (dom.selectFichaToTemplate) dom.selectFichaToTemplate.value = selectedFichasIds[0] || '';
        renderFichasList();
        markDirty();
      });

      fragment.appendChild(card);
    });

    dom.fichasList.appendChild(fragment);
  }

  function renderTokenSelects() {
    if (!dom.diceTokenSelect) return;
    const currentVal = dom.diceTokenSelect.value || (selectedFichasIds && selectedFichasIds[0]) || '';
    dom.diceTokenSelect.innerHTML = '<option value="">-- Sin ficha (Tirada general) --</option>';

    // Obtener fichas elegibles para asociar tiradas:
    // Que SOLO se vean las fichas presentes en la escena actual.
    // El DM ve todas las fichas de la escena activa (monstruos, NPCs, jugadores).
    // Los jugadores ven únicamente sus fichas propias presentes en la escena actual.
    const escenaActualId = state.escenaActiva?.id;
    const fichasDisponibles = (state.fichas || []).filter(f => {
      // Validar pertenencia a la escena actual
      const enEscena = (!escenaActualId || (f.escena_id && String(f.escena_id) === String(escenaActualId)) || (!f.escena_id && f.tipo === 'jugador'));
      if (!enEscena) return false;

      if (state.usuario?.esDM) return true;
      return esDuenioDeFicha(f);
    });

    fichasDisponibles.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      const tipoBadge = f.tipo ? ` [${f.tipo.toUpperCase()}]` : '';
      opt.textContent = `${f.nombre}${tipoBadge}`;
      if (f.id === currentVal) {
        opt.selected = true;
      }
      dom.diceTokenSelect.appendChild(opt);
    });

    if (currentVal) {
      dom.diceTokenSelect.value = currentVal;
    }
    // Si no coincide con ninguna opción, restablecer al primer elemento (-- Sin ficha --)
    // para evitar que el navegador deje selectedIndex en -1 y el desplegable se vea totalmente en blanco
    if (dom.diceTokenSelect.selectedIndex === -1) {
      dom.diceTokenSelect.selectedIndex = 0;
    }

    updateFichaToTemplateSelect();
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

  // --- GESTIÓN DE EFECTOS Y CONDICIONES (ALPHA) ---
  let currentEditingFichaEffectsId = null;

  function renderFichaEffectsHtml(ficha) {
    let efectos = [];
    if (Array.isArray(ficha.efectos)) efectos = ficha.efectos;
    else if (typeof ficha.efectos === 'string' && ficha.efectos.trim()) {
      try { efectos = JSON.parse(ficha.efectos); } catch (_) { efectos = []; }
    }
    if (!efectos || efectos.length === 0) return '';

    const canEdit = state.usuario?.esDM || esDuenioDeFicha(ficha);
    const chipsHtml = efectos.map(ef => {
      const bColor = ef.color || '#c9a84c';
      const iconOrImg = (ef.imagen && ef.imagen.startsWith('http'))
        ? `<img src="${ef.imagen}" style="width: 14px; height: 14px; border-radius: 2px; vertical-align: middle;">`
        : `<span>${ef.icono || '✨'}</span>`;
      const ruleHint = ef.ajusteDado && ef.ajusteDado !== 'ninguno' ? ` [Dados: ${ef.ajusteDado}]` : '';
      const removeBtn = canEdit ? `<span class="btn-remove-effect" data-ficha-id="${ficha.id}" data-efecto-id="${ef.id}" title="Quitar efecto">✕</span>` : '';
      return `<span class="ficha-effect-chip" style="border-color: ${bColor};" title="${ef.nombre}: ${ef.descripcion || 'Sin descripción'}${ruleHint}">${iconOrImg} ${ef.nombre}${removeBtn}</span>`;
    }).join('');

    return `<div class="ficha-effects-row">${chipsHtml}</div>`;
  }

  function updateDiceEffectsBanner() {
    const banner = document.getElementById('dice-effects-banner');
    const chipsEl = document.getElementById('dice-effects-chips');
    const expEl = document.getElementById('dice-effects-explanation');
    if (!banner || !chipsEl || !expEl) return;

    const tokenSelectVal = dom.diceTokenSelect ? dom.diceTokenSelect.value : '';
    const fichaId = tokenSelectVal || (selectedFichasIds && selectedFichasIds[0]) || '';
    const ficha = fichaId ? (state.fichas || []).find(f => f.id === fichaId) : null;

    if (!ficha) {
      banner.classList.add('hidden');
      return;
    }

    let efectos = [];
    if (Array.isArray(ficha.efectos)) efectos = ficha.efectos;
    else if (typeof ficha.efectos === 'string' && ficha.efectos.trim()) {
      try { efectos = JSON.parse(ficha.efectos); } catch (_) { efectos = []; }
    }

    if (!efectos || efectos.length === 0) {
      banner.classList.add('hidden');
      return;
    }

    banner.classList.remove('hidden');

    chipsEl.innerHTML = efectos.map(ef => {
      const bColor = ef.color || '#c9a84c';
      const icon = ef.icono || '✨';
      const modText = (ef.ajusteDado && ef.ajusteDado !== 'ninguno') ? ` (${ef.ajusteDado})` : '';
      return `<span class="ficha-effect-chip" style="border-color: ${bColor}; font-size: 0.76rem;" title="${ef.descripcion || ''}">${icon} ${ef.nombre}<strong>${modText}</strong></span>`;
    }).join('');

    const autoEnabled = state.autoDiceEffects !== false;
    const modsDesv = efectos.filter(e => e.ajusteDado === 'desventaja');
    const modsVent = efectos.filter(e => e.ajusteDado === 'ventaja');
    const modsBless = efectos.filter(e => e.ajusteDado === '+1d4');
    const modsBane = efectos.filter(e => e.ajusteDado === '-1d4');

    const explanations = [];
    if (modsDesv.length > 0) {
      const names = modsDesv.map(e => e.nombre).join(', ');
      explanations.push(autoEnabled
        ? `🌑 ${names}: Desventaja auto (2d20kl1).`
        : `⚠️ ${names}: Tienes Desventaja. Tira con desventaja manualmente si lo deseas.`);
    }
    if (modsVent.length > 0) {
      const names = modsVent.map(e => e.nombre).join(', ');
      explanations.push(autoEnabled
        ? `⭐ ${names}: Ventaja auto (2d20kh1).`
        : `⭐ ${names}: Tienes Ventaja. Tira con ventaja manualmente si lo deseas.`);
    }
    if (modsBless.length > 0) {
      explanations.push(autoEnabled
        ? `✨ Bendición: Sumará +1d4 automáticamente a la tirada.`
        : `✨ Bendición: Recuerda sumar +1d4 a tu tirada de ataque o salvación.`);
    }
    if (modsBane.length > 0) {
      explanations.push(autoEnabled
        ? `💀 Perdición: Restará -1d4 automáticamente a la tirada.`
        : `💀 Perdición: Recuerda restar -1d4 a tu tirada de ataque o salvación.`);
    }

    if (explanations.length === 0) {
      explanations.push(`ℹ️ Efectos informativos activos en ${ficha.nombre}. No modifican dados automáticamente.`);
    }

    expEl.innerHTML = explanations.join('<br>');
  }

  function openModalFichaEfectos(fichaId) {
    currentEditingFichaEffectsId = fichaId;
    const ficha = (state.fichas || []).find(f => f.id === fichaId);
    if (!ficha) return;

    const modal = document.getElementById('modal-ficha-efectos');
    const nameEl = document.getElementById('modal-effects-target-name');
    if (nameEl) {
      nameEl.innerHTML = `Asignando efectos a: <strong>${ficha.nombre}</strong> (${ficha.tipo || 'personaje'})`;
    }

    const chkCanvas = document.getElementById('check-canvas-alpha-effects');
    if (chkCanvas) chkCanvas.checked = state.alphaTokenEffects !== false;

    renderActiveFichaEffectsModal(ficha);
    renderDndConditionsCatalog();
    renderCustomEffectsSavedList();

    // Activar primera pestaña por defecto
    document.querySelectorAll('.btn-effects-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'tab-active-effects'));
    document.querySelectorAll('.effects-tab-content').forEach(c => c.classList.toggle('hidden', c.id !== 'tab-active-effects'));

    openModal(modal);
  }

  function renderActiveFichaEffectsModal(ficha) {
    const listEl = document.getElementById('ficha-active-effects-list');
    const countEl = document.getElementById('effects-active-count');
    if (!listEl) return;

    let efectos = [];
    if (Array.isArray(ficha.efectos)) efectos = ficha.efectos;
    else if (typeof ficha.efectos === 'string' && ficha.efectos.trim()) {
      try { efectos = JSON.parse(ficha.efectos); } catch (_) { efectos = []; }
    }

    if (countEl) countEl.textContent = String(efectos.length);

    if (efectos.length === 0) {
      listEl.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 24px; text-align: center; color: #94a3b8; font-size: 0.9rem;">
          <p><i class="fa-solid fa-shield-heart" style="font-size: 2rem; color: #64748b; margin-bottom: 8px;"></i></p>
          <p>Esta criatura no tiene ningún estado o efecto activo.</p>
          <p style="font-size: 0.8rem; margin-top: 6px; color: #c9a84c;">
            Haz clic en la pestaña <strong>"Condiciones D&D 5e"</strong> para añadir estados oficiales o en <strong>"Crear Efecto"</strong> para crear uno nuevo.
          </p>
        </div>
      `;
      return;
    }

    const canEdit = state.usuario?.esDM || esDuenioDeFicha(ficha);

    listEl.innerHTML = efectos.map(ef => {
      const bColor = ef.color || '#c9a84c';
      const icon = ef.icono || '✨';
      const diceTag = ef.ajusteDado && ef.ajusteDado !== 'ninguno'
        ? `<span class="active-effect-rule-tag" style="background: rgba(201, 168, 76, 0.2); color: #f0d060; border: 1px solid rgba(201,168,76,0.3);">🎲 ${ef.ajusteDado}</span>`
        : `<span class="active-effect-rule-tag" style="background: rgba(148, 163, 184, 0.15); color: #cbd5e1;">ℹ️ Informativo</span>`;

      return `
        <div class="active-effect-card" style="border-left: 3px solid ${bColor};">
          <div class="active-effect-card-header">
            <span class="active-effect-name">${icon} ${ef.nombre}</span>
            ${canEdit ? `<button type="button" class="btn btn-sm btn-danger btn-modal-remove-ef" data-efecto-id="${ef.id}" title="Quitar este efecto"><i class="fa-solid fa-trash"></i></button>` : ''}
          </div>
          <div class="active-effect-desc">${ef.descripcion || 'Sin descripción especial.'}</div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
            ${diceTag}
            <small style="color: #64748b; font-size: 0.7rem;">Duración: ${ef.duracion || 'Indefinida'}</small>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.btn-modal-remove-ef').forEach(btn => {
      btn.addEventListener('click', () => {
        const efId = btn.dataset.efectoId;
        if (currentEditingFichaEffectsId && efId) {
          removerEfectoDeFicha(currentEditingFichaEffectsId, efId);
        }
      });
    });
  }

  function renderDndConditionsCatalog(searchQuery = '', filterTag = 'todos') {
    const grid = document.getElementById('dnd5e-effects-grid');
    if (!grid) return;

    const query = searchQuery.toLowerCase().trim();
    const filtrados = CONDICIONES_DND5E.filter(c => {
      if (query && !c.nombre.toLowerCase().includes(query) && !c.descripcion.toLowerCase().includes(query)) {
        return false;
      }
      if (filterTag === 'desventaja' && c.ajusteDado !== 'desventaja') return false;
      if (filterTag === 'ventaja' && c.ajusteDado !== 'ventaja' && c.ajusteDado !== '+1d4') return false;
      if (filterTag === 'dados' && (!c.ajusteDado || c.ajusteDado === 'ninguno')) return false;
      return true;
    });

    if (filtrados.length === 0) {
      grid.innerHTML = '<div style="grid-column: 1 / -1; padding: 20px; text-align: center; color: #94a3b8;">No se encontraron condiciones con ese criterio.</div>';
      return;
    }

    grid.innerHTML = filtrados.map(c => {
      const bColor = c.color || '#c9a84c';
      const badgeHtml = c.ajusteDado && c.ajusteDado !== 'ninguno'
        ? `<span class="dnd-condition-badge" style="background: rgba(201, 168, 76, 0.2); color: #f0d060; border: 1px solid rgba(201,168,76,0.3);">${c.ajusteDado}</span>`
        : `<span class="dnd-condition-badge" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8;">Regla</span>`;

      return `
        <div class="dnd-condition-card" data-cond-id="${c.id}" style="border-left: 3px solid ${bColor};">
          <div class="dnd-condition-header">
            <span>${c.icono}</span>
            <span style="flex: 1;">${c.nombre}</span>
            ${badgeHtml}
          </div>
          <div class="dnd-condition-desc" title="${c.descripcion}">${c.descripcion}</div>
          <button type="button" class="btn btn-sm btn-secondary btn-apply-cond" style="margin-top: 6px; padding: 3px 6px; font-size: 0.72rem; width: 100%;">
            <i class="fa-solid fa-plus"></i> Aplicar a Ficha
          </button>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.btn-apply-cond').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = btn.closest('.dnd-condition-card');
        const condId = card?.dataset.condId;
        const cond = CONDICIONES_DND5E.find(c => c.id === condId);
        if (cond && currentEditingFichaEffectsId) {
          asignarEfectoAFicha(currentEditingFichaEffectsId, cond);
        }
      });
    });
  }

  function renderCustomEffectsSavedList() {
    const listEl = document.getElementById('custom-effects-saved-list');
    if (!listEl) return;

    const catalog = state.customEffectsCatalog || [];
    if (catalog.length === 0) {
      listEl.innerHTML = '<div style="color: #64748b; font-size: 0.8rem; padding: 6px;">No hay efectos personalizados creados todavía en esta partida.</div>';
      return;
    }

    listEl.innerHTML = catalog.map(ef => {
      const bColor = ef.color || '#c9a84c';
      return `
        <div class="dnd-condition-card" style="border-left: 3px solid ${bColor};">
          <div class="dnd-condition-header">
            <span>${ef.icono || '✨'}</span>
            <span style="flex: 1;">${ef.nombre}</span>
            ${state.usuario?.esDM ? `<button type="button" class="btn btn-sm btn-danger btn-del-cust-cat" data-id="${ef.id}" title="Eliminar de catálogo" style="padding: 1px 5px; font-size: 0.65rem;">✕</button>` : ''}
          </div>
          <div class="dnd-condition-desc">${ef.descripcion || 'Sin descripción'}</div>
          <button type="button" class="btn btn-sm btn-gold btn-apply-saved-custom" data-id="${ef.id}" style="margin-top: 4px; padding: 2px 6px; font-size: 0.72rem;">
            <i class="fa-solid fa-plus"></i> Aplicar
          </button>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.btn-apply-saved-custom').forEach(btn => {
      btn.addEventListener('click', () => {
        const ef = catalog.find(e => e.id === btn.dataset.id);
        if (ef && currentEditingFichaEffectsId) {
          asignarEfectoAFicha(currentEditingFichaEffectsId, ef);
        }
      });
    });

    listEl.querySelectorAll('.btn-del-cust-cat').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('¿Eliminar este efecto del catálogo de la partida?')) {
          socket?.emit('eliminar_efecto_catalogo', { partidaId: state.partida?.id, efectoId: btn.dataset.id });
        }
      });
    });
  }

  function asignarEfectoAFicha(fichaId, efecto) {
    if (!state.partida?.id || !fichaId || !efecto) return;
    socket?.emit('asignar_efecto_ficha', {
      partidaId: state.partida.id,
      fichaId,
      efecto
    });
    showToast(`✨ Efecto "${efecto.nombre}" asignado.`, 'gold');

    setTimeout(() => {
      const ficha = (state.fichas || []).find(f => f.id === fichaId);
      if (ficha) renderActiveFichaEffectsModal(ficha);
      updateDiceEffectsBanner();
      renderFichasList();
      markDirty();
    }, 150);
  }

  function removerEfectoDeFicha(fichaId, efectoId) {
    if (!state.partida?.id || !fichaId || !efectoId) return;
    socket?.emit('remover_efecto_ficha', {
      partidaId: state.partida.id,
      fichaId,
      efectoId
    });
    showToast('💨 Efecto retirado.', 'info');

    setTimeout(() => {
      const ficha = (state.fichas || []).find(f => f.id === fichaId);
      if (ficha) renderActiveFichaEffectsModal(ficha);
      updateDiceEffectsBanner();
      renderFichasList();
      markDirty();
    }, 150);
  }

  function updateStagingBanner() {
    if (!dom.dmStagingBanner) return;
    if (state.usuario?.esDM && state.escenaPreparacion) {
      dom.dmStagingBanner.classList.remove('hidden');
      if (dom.stagingViewingName) dom.stagingViewingName.textContent = state.escenaPreparacion.nombre || 'Escena';
      if (dom.stagingActiveName) dom.stagingActiveName.textContent = state.escenaActiva?.nombre || 'Escena activa';
      if (dom.currentSceneName) dom.currentSceneName.textContent = `[DM] ${state.escenaPreparacion.nombre}`;
    } else {
      dom.dmStagingBanner.classList.add('hidden');
      if (dom.currentSceneName) dom.currentSceneName.textContent = state.escenaActiva?.nombre || 'Escena Principal';
    }
  }

  function cargarEscenaEnModoPreparacion(escenaId) {
    if (!state.usuario?.esDM || !state.partida?.id) return;
    socket?.emit('dm_ver_escena', { partidaId: state.partida.id, escenaId });
  }

  function activarEscenaParaJugadores(escenaId) {
    if (!state.usuario?.esDM || !state.partida?.id) return;
    const posicionesActuales = (state.fichas || []).map(f => ({
      fichaId: f.id,
      x: f.x,
      y: f.y
    }));
    state.escenaPreparacion = null;
    socket?.emit('cambiar_escena', {
      partidaId: state.partida.id,
      escenaId,
      escenaAnteriorId: state.escenaActiva?.id,
      posicionesActuales
    });
  }

  function renderScenesList() {
    if (!dom.scenesList) return;
    dom.scenesList.innerHTML = '';
    const escenaActual = getEscenaActual();
    const escenaActivaId = state.escenaActiva?.id;
    const escenaPrepId = state.escenaPreparacion?.id;

    (state.escenas || []).forEach(sc => {
      const isPartyActive = sc.id === escenaActivaId;
      const isBeingEdited = Boolean(escenaPrepId && sc.id === escenaPrepId);
      const isShowingNow = sc.id === escenaActual?.id;

      const item = document.createElement('div');
      item.className = `scene-item ${isPartyActive ? 'active-game' : ''} ${isShowingNow ? 'editing-screen' : ''}`;

      let badgesHtml = '';
      if (isPartyActive) {
        badgesHtml += `<span class="scene-badge-party" title="Aquí se encuentran los jugadores"><i class="fa-solid fa-users"></i> En Juego</span>`;
      }
      if (isBeingEdited) {
        badgesHtml += `<span class="scene-badge-editing" title="Estás editando esta escena en privado"><i class="fa-solid fa-eye"></i> En Pantalla (DM)</span>`;
      }

      let actionsHtml = '';
      if (isPartyActive && !escenaPrepId) {
        actionsHtml = `
          <button class="btn btn-sm btn-outline" disabled title="Esta escena está en pantalla y activa para jugadores"><i class="fa-solid fa-check"></i> Activa</button>
        `;
      } else if (isPartyActive && escenaPrepId) {
        actionsHtml = `
          <button class="btn btn-sm btn-secondary btn-return-scene" title="Regresar a ver la escena donde juegan los demás"><i class="fa-solid fa-arrow-turn-down"></i> Ver Activa</button>
        `;
      } else {
        actionsHtml = `
          <button class="btn btn-sm ${isShowingNow ? 'btn-gold' : 'btn-info'} btn-stage-scene" title="Ver y preparar mapa/props sin mover a los jugadores"><i class="fa-solid fa-eye"></i> ${isShowingNow ? 'Editando' : 'Gestionar'}</button>
          <button class="btn btn-sm btn-primary btn-load-scene" title="Activar esta escena para todos los jugadores"><i class="fa-solid fa-play"></i> Activar</button>
        `;
      }

      actionsHtml += `<button class="btn btn-sm btn-danger btn-del-scene" title="Eliminar escena"><i class="fa-solid fa-trash"></i></button>`;

      item.innerHTML = `
        <div class="scene-header-row">
          <span class="scene-title-wrap">🎬 ${sc.nombre}</span>
          ${badgesHtml}
        </div>
        <div class="scene-actions-row">
          ${actionsHtml}
        </div>
      `;

      item.querySelector('.btn-return-scene')?.addEventListener('click', () => {
        cargarEscenaEnModoPreparacion(escenaActivaId);
      });

      item.querySelector('.btn-stage-scene')?.addEventListener('click', () => {
        cargarEscenaEnModoPreparacion(sc.id);
      });

      item.querySelector('.btn-load-scene')?.addEventListener('click', () => {
        activarEscenaParaJugadores(sc.id);
      });

      item.querySelector('.btn-del-scene')?.addEventListener('click', () => {
        if (confirm(`¿Eliminar la escena "${sc.nombre}"?`)) {
          socket?.emit('eliminar_escena', { partidaId: state.partida.id, escenaId: sc.id });
        }
      });

      dom.scenesList.appendChild(item);
    });
  }

  // --- EXPERIMENTAL: CAPAS Y OBJETOS (PROPS) ---
  function getPropPresetSvg(presetId) {
    const svgs = {
      carro: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"><rect x="10" y="8" width="30" height="14" rx="4" fill="#1e293b"/><rect x="160" y="8" width="30" height="14" rx="4" fill="#1e293b"/><rect x="10" y="78" width="30" height="14" rx="4" fill="#1e293b"/><rect x="160" y="78" width="30" height="14" rx="4" fill="#1e293b"/><rect x="25" y="15" width="150" height="70" rx="16" fill="#854d0e" stroke="#ca8a04" stroke-width="3"/><rect x="50" y="24" width="90" height="52" rx="8" fill="#1c1917" stroke="#78350f" stroke-width="2"/><path d="M55,30 L135,30 L125,70 L65,70 Z" fill="#38bdf8" opacity="0.45"/><circle cx="170" cy="32" r="6" fill="#fef08a"/><circle cx="170" cy="68" r="6" fill="#fef08a"/></svg>`,
      arbol: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><circle cx="50" cy="50" r="46" fill="#14532d" opacity="0.85"/><circle cx="38" cy="40" r="28" fill="#166534"/><circle cx="62" cy="42" r="26" fill="#15803d"/><circle cx="48" cy="62" r="27" fill="#22c55e" opacity="0.9"/><circle cx="50" cy="50" r="9" fill="#78350f"/></svg>`,
      cajas: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><rect x="6" y="6" width="42" height="42" rx="4" fill="#78350f" stroke="#b45309" stroke-width="3"/><line x1="6" y1="6" x2="48" y2="48" stroke="#b45309" stroke-width="2"/><rect x="52" y="12" width="42" height="42" rx="4" fill="#92400e" stroke="#d97706" stroke-width="3"/><line x1="52" y1="54" x2="94" y2="12" stroke="#d97706" stroke-width="2"/><rect x="24" y="50" width="46" height="44" rx="4" fill="#451a03" stroke="#92400e" stroke-width="3"/><line x1="24" y1="50" x2="70" y2="94" stroke="#92400e" stroke-width="2"/></svg>`,
      mesa: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 100" width="150" height="100"><rect x="10" y="12" width="130" height="76" rx="10" fill="#78350f" stroke="#d97706" stroke-width="4"/><line x1="10" y1="36" x2="140" y2="36" stroke="#451a03" stroke-width="2"/><line x1="10" y1="64" x2="140" y2="64" stroke="#451a03" stroke-width="2"/><circle cx="45" cy="50" r="12" fill="#e2e8f0" stroke="#94a3b8" stroke-width="2"/><circle cx="105" cy="50" r="12" fill="#e2e8f0" stroke="#94a3b8" stroke-width="2"/><circle cx="75" cy="50" r="8" fill="#ca8a04"/></svg>`,
      sangre: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><path d="M50,15 C65,18 78,32 72,48 C85,55 92,70 78,82 C65,92 45,95 32,85 C18,75 15,58 26,45 C15,35 25,20 40,22 Z" fill="#991b1b" opacity="0.85"/><circle cx="78" cy="25" r="5" fill="#7f1d1d" opacity="0.8"/><circle cx="20" cy="72" r="4" fill="#7f1d1d" opacity="0.8"/><circle cx="85" cy="78" r="3" fill="#7f1d1d" opacity="0.8"/></svg>`,
      crater: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><circle cx="50" cy="50" r="45" fill="#18181b" stroke="#71717a" stroke-width="3" stroke-dasharray="6,4"/><circle cx="50" cy="50" r="32" fill="#27272a"/><circle cx="50" cy="50" r="18" fill="#09090b"/><path d="M50,5 L50,25 M95,50 L75,50 M50,95 L50,75 M5,50 L25,50" stroke="#52525b" stroke-width="3"/></svg>`,
      carpa: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><polygon points="50,10 90,85 10,85" fill="#475569" stroke="#94a3b8" stroke-width="3"/><polygon points="50,10 50,85 10,85" fill="#334155"/><polygon points="50,45 65,85 35,85" fill="#0f172a"/></svg>`,
      puerta: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 100" width="50" height="100"><rect x="5" y="5" width="40" height="90" rx="4" fill="#5c2c16" stroke="#b45309" stroke-width="4"/><line x1="5" y1="35" x2="45" y2="35" stroke="#b45309" stroke-width="3"/><line x1="5" y1="65" x2="45" y2="65" stroke="#b45309" stroke-width="3"/><circle cx="38" cy="50" r="4" fill="#fbbf24"/></svg>`
    };
    const raw = svgs[presetId] || svgs.carro;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(raw);
  }

  function toggleExperimentalPropsUI(enabled) {
    state.experimentalPropsEnabled = Boolean(enabled);
    if (dom.checkExperimentalProps) dom.checkExperimentalProps.checked = state.experimentalPropsEnabled;
    try {
      localStorage.setItem('vtt_exp_props', state.experimentalPropsEnabled ? 'true' : 'false');
      if (state.partida?.codigo) {
        localStorage.setItem('vtt_exp_props_' + state.partida.codigo, state.experimentalPropsEnabled ? 'true' : 'false');
      }
    } catch (_) { }

    const propsSec = document.getElementById('dm-props-section');
    if (state.usuario?.esDM && state.experimentalPropsEnabled) {
      dom.toolProps?.classList.remove('hidden');
      if (propsSec) propsSec.classList.remove('hidden');
      renderPropsList();
    } else {
      dom.toolProps?.classList.add('hidden');
      if (propsSec) propsSec.classList.add('hidden');
      if (activeTool === 'props') {
        activeTool = 'move';
        dom.toolButtons?.forEach(b => b.classList.toggle('active', b.dataset.tool === 'move'));
        dom.toolOptionsContainer?.classList.add('hidden');
        dom.optProps?.classList.add('hidden');
      }
    }
    markDirty();
  }

  function renderPropsList() {
    if (!dom.dmPropsList) return;
    dom.dmPropsList.innerHTML = '';
    const currentSceneId = getEscenaActual()?.id;
    const sceneProps = (state.props || []).filter(p => !currentSceneId || p.escena_id === currentSceneId);

    if (sceneProps.length === 0) {
      dom.dmPropsList.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem; padding:8px; text-align:center;">No hay objetos colocados en esta escena.</div>';
      return;
    }

    sceneProps.forEach(prop => {
      const card = document.createElement('div');
      card.className = `prop-item-card ${selectedPropId === prop.id ? 'selected' : ''}`;
      const layerNames = {
        'suelo': 'Suelo (Fondo)',
        'debajo_fichas': 'Debajo de Fichas',
        'encima_fichas': 'Encima de Fichas'
      };
      const layerName = layerNames[prop.capa] || prop.capa;

      card.innerHTML = `
        <div class="prop-item-header">
          <img src="${prop.imagen}" class="prop-thumb" alt="${prop.nombre}">
          <div class="prop-item-info">
            <div class="prop-name">${prop.nombre}</div>
            <div class="prop-meta">${prop.ancho}x${prop.alto} casillas | ${layerName}</div>
          </div>
        </div>
        <div class="prop-actions">
          <button class="btn btn-sm ${prop.bloqueado ? 'btn-warning' : 'btn-secondary'} btn-prop-lock" title="${prop.bloqueado ? 'Desbloquear movimiento' : 'Bloquear posición'}">
            <i class="fa-solid ${prop.bloqueado ? 'fa-lock' : 'fa-lock-open'}"></i>
          </button>
          <button class="btn btn-sm btn-secondary btn-prop-locate" title="Centrar cámara en este objeto">
            <i class="fa-solid fa-crosshairs"></i>
          </button>
          <button class="btn btn-sm btn-danger btn-prop-del" title="Eliminar objeto">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      `;

      card.querySelector('.btn-prop-lock')?.addEventListener('click', (e) => {
        e.stopPropagation();
        prop.bloqueado = prop.bloqueado ? 0 : 1;
        socket?.emit('guardar_prop', {
          partidaId: state.partida.id,
          escenaId: currentSceneId,
          propData: prop
        });
        renderPropsList();
        markDirty();
      });

      card.querySelector('.btn-prop-locate')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (canvas) {
          const tileSize = getTileSize();
          viewport.panX = canvas.width / 2 - ((prop.x + prop.ancho / 2) * tileSize);
          viewport.panY = canvas.height / 2 - ((prop.y + prop.alto / 2) * tileSize);
          selectedPropId = prop.id;
          renderPropsList();
          markDirty();
        }
      });

      card.querySelector('.btn-prop-del')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`¿Eliminar el objeto "${prop.nombre}"?`)) {
          socket?.emit('eliminar_prop', {
            partidaId: state.partida.id,
            escenaId: currentSceneId,
            propId: prop.id
          });
        }
      });

      card.addEventListener('click', () => {
        selectedPropId = (selectedPropId === prop.id) ? null : prop.id;
        renderPropsList();
        markDirty();
      });

      dom.dmPropsList.appendChild(card);
    });
  }

  // Helper para calcular modificador de habilidad D&D (+2, -1, etc.)
  function getDndModifier(score) {
    const num = Number(score) || 10;
    const mod = Math.floor((num - 10) / 2);
    return mod >= 0 ? `+${mod}` : `${mod}`;
  }

  // Actualizar indicador visual de modificador para un atributo
  function updateStatModDisplay(inputId, modId) {
    const input = document.getElementById(inputId);
    const modEl = document.getElementById(modId);
    if (!input || !modEl) return;
    const val = parseInt(input.value, 10);
    const score = isNaN(val) ? 10 : val;
    const mod = Math.floor((score - 10) / 2);
    modEl.textContent = mod >= 0 ? `+${mod}` : `${mod}`;
    if (mod > 0) {
      modEl.style.color = '#4ade80';
    } else if (mod < 0) {
      modEl.style.color = '#f87171';
    } else {
      modEl.style.color = 'var(--gold-light)';
    }
    return mod;
  }

  // Actualizar los 6 modificadores y opcionalmente sincronizar iniciativa
  function updateAllFichaStatMods(autoUpdateIni = false) {
    const stats = [
      { inputId: 'ficha-fue', modId: 'mod-ficha-fue' },
      { inputId: 'ficha-des', modId: 'mod-ficha-des' },
      { inputId: 'ficha-con', modId: 'mod-ficha-con' },
      { inputId: 'ficha-int', modId: 'mod-ficha-int' },
      { inputId: 'ficha-sab', modId: 'mod-ficha-sab' },
      { inputId: 'ficha-car', modId: 'mod-ficha-car' }
    ];
    stats.forEach(s => {
      const mod = updateStatModDisplay(s.inputId, s.modId);
      if (s.inputId === 'ficha-des' && autoUpdateIni) {
        const iniInput = document.getElementById('ficha-ini');
        if (iniInput && mod !== undefined) {
          iniInput.value = mod;
        }
      }
    });
  }

  // Actualizar selector desplegable de fichas para guardar como plantilla
  function updateFichaToTemplateSelect() {
    if (!dom.selectFichaToTemplate) return;
    const currentVal = dom.selectFichaToTemplate.value;
    dom.selectFichaToTemplate.innerHTML = '<option value="">-- Ficha --</option>';

    (state.fichas || []).forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = `${f.nombre} (${(f.tipo || 'ficha').toUpperCase()})`;
      if (selectedFichasIds.includes(f.id)) {
        opt.selected = true;
      }
      dom.selectFichaToTemplate.appendChild(opt);
    });

    if (currentVal && !selectedFichasIds.length) {
      dom.selectFichaToTemplate.value = currentVal;
    }
  }

  // Invocación inteligente de plantilla en el centro de la vista del mapa
  function spawnFromTemplate(templateData, quantity = 1) {
    if (!state.escenaActiva?.id) {
      showToast('No hay escena activa para invocar criaturas.', 'warning');
      return;
    }
    const d = typeof templateData === 'string' ? JSON.parse(templateData) : templateData;

    // Calcular centro del lienzo actual según pan y zoom
    let baseX = 5;
    let baseY = 5;
    if (canvas && viewport) {
      const visibleTileX = Math.floor((-viewport.panX + canvas.width / 2) / (viewport.tileSize * viewport.zoom));
      const visibleTileY = Math.floor((-viewport.panY + canvas.height / 2) / (viewport.tileSize * viewport.zoom));
      if (!isNaN(visibleTileX) && !isNaN(visibleTileY)) {
        baseX = Math.max(0, visibleTileX);
        baseY = Math.max(0, visibleTileY);
      }
    }

    const defaultRevelado = JSON.stringify({
      global: { imagen: false, nombre: false, hp: false, ac: false, notas: false },
      jugadores: {}
    });

    for (let i = 0; i < quantity; i++) {
      const clone = JSON.parse(JSON.stringify(d));
      delete clone.id; // Asignar nuevo ID único en el servidor

      // Dispersión espacial para que no queden superpuestas en el mismo píxel
      const offsetX = quantity > 1 ? (i % 2 === 0 ? Math.floor(i / 2) : -Math.ceil(i / 2)) : 0;
      const offsetY = quantity > 1 ? Math.floor(i / 2) : 0;
      clone.x = Math.max(0, baseX + offsetX);
      clone.y = Math.max(0, baseY + offsetY);

      if (quantity > 1) {
        clone.nombre = `${clone.nombre} #${i + 1}`;
      }

      socket?.emit('crear_ficha', {
        partidaId: state.partida.id,
        escenaId: state.escenaActiva.id,
        fichaData: clone
      });
    }

    showToast(`✨ ${quantity > 1 ? quantity + 'x ' : ''}${d.nombre} invocado(s) en el mapa`, 'success');
  }

  // Abrir inspector modal con ficha y notas completas de la plantilla
  function abrirDetallePlantilla(g) {
    let d;
    try {
      d = typeof g.datos === 'string' ? JSON.parse(g.datos) : g.datos;
    } catch (_) {
      d = { nombre: g.nombre, tipo: 'monstruo' };
    }
    inspectingTemplateData = d;

    if (dom.templateDetailAvatar) {
      dom.templateDetailAvatar.src = d.imagen || 'https://via.placeholder.com/64?text=🐲';
      dom.templateDetailAvatar.style.borderColor = d.color_aro || 'var(--gold-primary)';
    }
    if (dom.templateDetailName) dom.templateDetailName.textContent = g.nombre;
    if (dom.templateDetailType) {
      const tipo = (d.tipo || 'monstruo').toLowerCase();
      dom.templateDetailType.textContent = tipo.toUpperCase();
      dom.templateDetailType.className = `badge-tag tag-${tipo === 'monstruo' ? 'monster' : tipo === 'npc' ? 'npc' : 'player'}`;
    }
    if (dom.templateDetailSize) dom.templateDetailSize.textContent = formatTamanioBase(d.tamanio_base);
    if (dom.templateDetailLevel) dom.templateDetailLevel.textContent = `Nivel ${d.nivel || 1}`;

    if (dom.templateDetailHp) dom.templateDetailHp.textContent = `${d.hp_actual || d.hp_maximo || 10}/${d.hp_maximo || 10}`;
    if (dom.templateDetailAc) dom.templateDetailAc.textContent = d.ac ?? 10;
    if (dom.templateDetailSpeed) dom.templateDetailSpeed.textContent = `${d.velocidad ?? 30}ft`;
    if (dom.templateDetailIni) dom.templateDetailIni.textContent = d.iniciativa ?? 0;

    // Atributos D&D y modificadores
    const str = d.fuerza ?? 10;
    const dex = d.destreza ?? 10;
    const con = d.constitucion ?? 10;
    const intVal = d.inteligencia ?? 10;
    const wis = d.sabiduria ?? 10;
    const cha = d.carisma ?? 10;

    if (dom.templateDetailStr) dom.templateDetailStr.textContent = str;
    if (dom.templateModStr) dom.templateModStr.textContent = getDndModifier(str);
    if (dom.templateDetailDex) dom.templateDetailDex.textContent = dex;
    if (dom.templateModDex) dom.templateModDex.textContent = getDndModifier(dex);
    if (dom.templateDetailCon) dom.templateDetailCon.textContent = con;
    if (dom.templateModCon) dom.templateModCon.textContent = getDndModifier(con);
    if (dom.templateDetailInt) dom.templateDetailInt.textContent = intVal;
    if (dom.templateModInt) dom.templateModInt.textContent = getDndModifier(intVal);
    if (dom.templateDetailWis) dom.templateDetailWis.textContent = wis;
    if (dom.templateModWis) dom.templateModWis.textContent = getDndModifier(wis);
    if (dom.templateDetailCha) dom.templateDetailCha.textContent = cha;
    if (dom.templateModCha) dom.templateModCha.textContent = getDndModifier(cha);

    if (dom.templateDetailNotes) {
      dom.templateDetailNotes.textContent = d.notas && d.notas.trim() !== '' ? d.notas : 'Sin notas ni habilidades registradas.';
    }

    updateSpawnQuantityUI();
    openModal(dom.modalTemplateDetail);
  }

  function updateSpawnQuantityUI() {
    if (dom.inputModalSpawnQty) dom.inputModalSpawnQty.value = gallerySpawnQuantity;
    if (dom.inputDetailSpawnQty) dom.inputDetailSpawnQty.value = gallerySpawnQuantity;
    document.querySelectorAll('.btn-quick-qty').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.qty, 10) === gallerySpawnQuantity);
    });
    document.querySelectorAll('.btn-spawn-template').forEach(btn => {
      btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Invocar ${gallerySpawnQuantity > 1 ? `(x${gallerySpawnQuantity})` : ''}`;
    });
    if (dom.btnSpawnFromDetail) {
      dom.btnSpawnFromDetail.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Invocar al Mapa ${gallerySpawnQuantity > 1 ? `(x${gallerySpawnQuantity})` : ''}`;
    }
  }

  // Renderizar la Galería de Plantillas en Modal de Bestiario
  function renderGalleryChips() {
    if (dom.dmGalleryList) dom.dmGalleryList.innerHTML = '';
    if (dom.dmGalleryModalGrid) dom.dmGalleryModalGrid.innerHTML = '';

    const allTemplates = state.galeria || [];
    const totalCount = allTemplates.length;

    if (dom.dmGalleryCount) dom.dmGalleryCount.textContent = totalCount;
    if (dom.modalGalleryCount) dom.modalGalleryCount.textContent = `${totalCount} plantilla${totalCount === 1 ? '' : 's'}`;

    // Filtrar plantillas según texto de búsqueda y tipo activo
    const filtered = allTemplates.filter(g => {
      let d;
      try {
        d = typeof g.datos === 'string' ? JSON.parse(g.datos) : g.datos;
      } catch (_) {
        d = { nombre: g.nombre, tipo: 'monstruo' };
      }

      // Filtro de texto (nombre o notas)
      if (galleryFilterText) {
        const q = galleryFilterText.toLowerCase();
        const matchesName = (g.nombre || '').toLowerCase().includes(q);
        const matchesNotes = (d.notas || '').toLowerCase().includes(q);
        if (!matchesName && !matchesNotes) return false;
      }

      // Filtro de tipo (monstruo, npc, jugador)
      if (galleryFilterType !== 'all') {
        const itemType = (d.tipo || 'monstruo').toLowerCase();
        if (itemType !== galleryFilterType) return false;
      }

      return true;
    });

    if (filtered.length === 0) {
      const emptyHtml = `
        <div class="gallery-empty-state">
          <i class="fa-solid fa-dragon"></i>
          <p>${totalCount === 0 ? 'No hay plantillas guardadas aún.' : 'No se encontraron plantillas con ese filtro.'}</p>
          <span style="font-size:0.75rem; color:#64748b;">${totalCount === 0 ? 'Guarda monstruos o NPCs para invocarlos rápidamente.' : 'Intenta cambiar la búsqueda o el filtro.'}</span>
        </div>
      `;
      if (dom.dmGalleryModalGrid) dom.dmGalleryModalGrid.innerHTML = emptyHtml;
      return;
    }

    // Helper para construir una tarjeta visual de plantilla
    function buildTemplateCard(g) {
      let d;
      try {
        d = typeof g.datos === 'string' ? JSON.parse(g.datos) : g.datos;
      } catch (_) {
        d = { nombre: g.nombre, tipo: 'monstruo' };
      }

      const card = document.createElement('div');
      card.className = 'template-card';
      card.dataset.id = g.id;

      const avatarSrc = d.imagen || 'https://via.placeholder.com/48?text=🐲';
      const aroColor = d.color_aro || 'var(--gold-primary)';
      const tipo = (d.tipo || 'monstruo').toLowerCase();
      const tipoTag = tipo === 'monstruo' ? 'tag-monster' : tipo === 'npc' ? 'tag-npc' : 'tag-player';
      const hp = d.hp_maximo || d.hp_actual || 10;
      const ac = d.ac ?? 10;
      const vel = d.velocidad ?? 30;
      const tamanio = formatTamanioBase(d.tamanio_base);

      card.innerHTML = `
        <div class="template-card-header">
          <div class="template-avatar-wrap">
            <img src="${avatarSrc}" class="template-avatar" style="border-color: ${aroColor};" alt="${g.nombre}">
          </div>
          <div class="template-main-info">
            <div class="template-name-row">
              <h5 class="template-name" title="${g.nombre}">${g.nombre}</h5>
              <span class="badge-tag ${tipoTag}">${tipo.toUpperCase()}</span>
            </div>
            <div class="template-stat-pills">
              <span class="stat-pill hp" title="Puntos de Golpe"><i class="fa-solid fa-heart"></i> ${hp} HP</span>
              <span class="stat-pill ac" title="Clase de Armadura"><i class="fa-solid fa-shield-halved"></i> CA ${ac}</span>
              <span class="stat-pill spd" title="Velocidad"><i class="fa-solid fa-person-running"></i> ${vel}ft</span>
            </div>
            <div style="font-size:0.7rem; color:#94a3b8; display:flex; gap:8px; align-items:center; margin-top:2px;">
              <span><i class="fa-solid fa-up-right-and-down-left-from-center"></i> ${tamanio}</span>
              ${d.notas && d.notas.trim() ? '<span style="color:var(--gold-light);"><i class="fa-solid fa-scroll"></i> Con notas</span>' : ''}
            </div>
          </div>
        </div>
        <div class="template-card-actions">
          <button class="btn btn-sm btn-gold btn-spawn-template" title="Invocar criatura al mapa">
            <i class="fa-solid fa-wand-magic-sparkles"></i> Invocar ${gallerySpawnQuantity > 1 ? `(x${gallerySpawnQuantity})` : ''}
          </button>
          <button class="btn btn-sm btn-secondary btn-inspect-template" title="Ver ficha y notas completas">
            <i class="fa-solid fa-eye"></i>
          </button>
          <button class="btn btn-sm btn-danger btn-del-template" title="Eliminar de la galería">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      `;

      card.querySelector('.btn-spawn-template').addEventListener('click', () => {
        spawnFromTemplate(d, gallerySpawnQuantity || 1);
      });

      card.querySelector('.btn-inspect-template').addEventListener('click', () => {
        abrirDetallePlantilla(g);
      });

      card.querySelector('.btn-del-template').addEventListener('click', () => {
        if (confirm(`¿Eliminar la plantilla "${g.nombre}" de la galería?`)) {
          socket?.emit('eliminar_galeria', { partidaId: state.partida.id, galeriaId: g.id });
          showToast(`🗑️ Plantilla "${g.nombre}" eliminada.`, 'info');
        }
      });

      return card;
    }

    if (dom.dmGalleryModalGrid) {
      filtered.forEach(g => {
        dom.dmGalleryModalGrid.appendChild(buildTemplateCard(g));
      });
    }

    updateSpawnQuantityUI();
  }

  function renderChatMessages() {
    dom.chatMessagesContainer.innerHTML = '';
    (state.mensajes || []).forEach(renderChatMessage);
    scrollChatToBottom();
  }

  function renderHistoryTable() {
    if (!dom.historyTableBody) return;
    const tabHistorial = document.getElementById('tab-historial');
    if (tabHistorial && !tabHistorial.classList.contains('active')) return;

    dom.historyTableBody.innerHTML = '';
    const q = (dom.searchHistoryInput?.value || '').toLowerCase();
    const filtered = (state.historial || []).filter(h => (h.nombre_usuario || '').toLowerCase().includes(q) || (h.nombre_ficha || '').toLowerCase().includes(q));

    const startIdx = (historyPage - 1) * historyPerPage;
    const pageItems = filtered.slice(startIdx, startIdx + historyPerPage);
    const fragment = document.createDocumentFragment();

    pageItems.forEach(item => {
      const tr = document.createElement('tr');
      const fichaTag = item.nombre_ficha ? `<br><small style="color:#38bdf8; font-weight:normal;">🎯 ${item.nombre_ficha}</small>` : '';
      tr.innerHTML = `
        <td style="color:${item.color_usuario || '#c9a84c'}; font-weight:bold;">${item.nombre_usuario}${fichaTag}</td>
        <td><code>${item.formula}</code></td>
        <td>${item.tipo}</td>
        <td style="font-weight:bold; color:#f0d060;">${item.resultado}</td>
        <td style="font-size:0.75rem; color:#94a3b8;">${new Date(item.fecha).toLocaleTimeString()}</td>
      `;
      fragment.appendChild(tr);
    });
    dom.historyTableBody.appendChild(fragment);

    const totalPages = Math.ceil(filtered.length / historyPerPage) || 1;
    if (dom.histPageInfo) dom.histPageInfo.textContent = `Página ${historyPage} de ${totalPages}`;
  }

  function renderQuickHistory() {
    if (!dom.quickDiceHistory) return;
    dom.quickDiceHistory.innerHTML = '';
    const last5 = (state.historial || []).slice(0, 5);
    const fragment = document.createDocumentFragment();
    last5.forEach(h => {
      const div = document.createElement('div');
      const fichaTag = h.nombre_ficha ? ` <span style="color:#38bdf8; font-size:0.85em;">[${h.nombre_ficha}]</span>` : '';
      div.innerHTML = `<strong>${h.nombre_usuario}</strong>${fichaTag}: ${h.formula} = <strong class="gold-text">${h.resultado}</strong> (${h.tipo})`;
      fragment.appendChild(div);
    });
    dom.quickDiceHistory.appendChild(fragment);
  }

  function openEditGameModal(partidaData) {
    if (!dom.modalEditGame) return;
    if (dom.editGameId) dom.editGameId.value = partidaData.id || '';
    if (dom.editGameTitle) dom.editGameTitle.value = partidaData.nombre || '';
    if (dom.editGameImgUrl) dom.editGameImgUrl.value = partidaData.imagen_portada || '';
    if (dom.editGameImgFile) dom.editGameImgFile.value = '';

    const previewImg = dom.editGamePreviewImg;
    if (previewImg) {
      if (partidaData.imagen_portada) {
        previewImg.src = partidaData.imagen_portada;
        previewImg.style.display = 'block';
      } else {
        previewImg.src = '';
        previewImg.style.display = 'none';
      }
    }

    openModal(dom.modalEditGame);
    setTimeout(() => {
      if (dom.editGameTitle) dom.editGameTitle.focus();
    }, 150);
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

      const currentUserId = (localStorage.getItem('vtt_user_id') || '').toLowerCase().trim();
      const currentUsername = (localStorage.getItem('vtt_username') || '').toLowerCase().trim();

      partidas.forEach(p => {
        const card = document.createElement('div');
        card.className = 'game-card';
        const imagenHtml = p.imagen_portada ? `<img src="${p.imagen_portada}" alt="Portada" style="width: 100%; height: 120px; object-fit: cover; border-radius: 4px; margin-bottom: 8px;">` : '';
        const nombreLimpio = limpiarNombrePartida(p.nombre);
        p.nombre = nombreLimpio;

        const pDmId = (p.dm_id || '').toLowerCase().trim();
        const isCreator = !pDmId || (currentUserId && pDmId === currentUserId) || (currentUsername && pDmId.includes(currentUsername)) || (currentUserId && currentUserId.includes(pDmId));
        const editBtnHtml = isCreator ? `<button class="btn btn-secondary btn-sm btn-edit-game" title="Modificar Nombre e Imagen"><i class="fa-solid fa-pen-to-square"></i></button>` : '';

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
            ${editBtnHtml}
            <button class="btn btn-secondary btn-sm btn-export-game" title="Guardar Sesión en Escritorio"><i class="fa-solid fa-download"></i></button>
            <button class="btn btn-danger btn-sm btn-del-game"><i class="fa-solid fa-trash"></i></button>
          </div>
        `;

        const handleEnterGame = (e) => {
          if (e) e.stopPropagation();
          let username = (dom.lobbyUsernameInput ? dom.lobbyUsernameInput.value.trim() : '') || (localStorage.getItem('vtt_username') || state.usuario?.nombre || '').trim();
          if (!username) {
            if (dom.lobbyUsernameInput) {
              dom.lobbyUsernameInput.focus();
              dom.lobbyUsernameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
              showToast('⚠️ Escribe tu nombre de jugador arriba antes de entrar a la partida', 'warning');
            } else {
              if (dom.joinCodeInput) dom.joinCodeInput.value = p.codigo;
              if (dom.joinUsernameInput) dom.joinUsernameInput.value = '';
              loadJoinModalSessionsList();
              openModal(dom.modalJoinGame);
              setTimeout(() => dom.joinUsernameInput?.focus(), 150);
            }
            return;
          }
          saveLobbyUsername(username);
          joinGameDirect(p.codigo, username);
        };

        const btnLoad = card.querySelector('.btn-load-game');
        if (btnLoad) btnLoad.addEventListener('click', handleEnterGame);
        const cardTitle = card.querySelector('.card-title');
        if (cardTitle) {
          cardTitle.style.cursor = 'pointer';
          cardTitle.addEventListener('click', handleEnterGame);
        }
        const cardImg = card.querySelector('img');
        if (cardImg) {
          cardImg.style.cursor = 'pointer';
          cardImg.addEventListener('click', handleEnterGame);
        }
        card.style.cursor = 'pointer';
        card.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          handleEnterGame(e);
        });

        const btnEdit = card.querySelector('.btn-edit-game');
        if (btnEdit) {
          btnEdit.addEventListener('click', (e) => {
            e.stopPropagation();
            openEditGameModal(p);
          });
        }

        card.querySelector('.btn-export-game')?.addEventListener('click', (e) => {
          e.stopPropagation();
          descargarPartidaAlPc(p.id, p.nombre, p.codigo);
        });

        const btnDel = card.querySelector('.btn-del-game');
        if (btnDel) {
          btnDel.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm(`¿Eliminar definitivamente la partida "${p.nombre}" (${p.codigo})?\n\nEsta acción borrará todas sus escenas, fichas y datos guardados de forma permanente.`)) {
              try {
                const res = await fetch(`/api/partidas/${p.id}`, { method: 'DELETE' });
                if (!res.ok) {
                  const errJson = await res.json().catch(() => ({}));
                  throw new Error(errJson.error || 'Error en el servidor al eliminar');
                }
                showToast(`🗑️ Partida "${p.nombre}" eliminada`, 'info');
                await loadGamesList();
              } catch (err) {
                alert('No se pudo eliminar la partida: ' + err.message);
              }
            }
          });
        }

        dom.gamesList.appendChild(card);
      });

    } catch (err) {
      console.warn('Servidor no disponible o modo offline');
      dom.gamesList.innerHTML = '<div class="empty-state">Conéctate al servidor ejecutando `npm start` para cargar partidas.</div>';
    }
  }

  // --- CARGAR LISTA DE SESIONES EN EL MODAL 'UNIRSE CON CÓDIGO' ---
  async function loadJoinModalSessionsList() {
    if (!dom.joinAvailableGamesList) return;
    try {
      dom.joinAvailableGamesList.innerHTML = '<div style="color: #64748b; font-size: 0.8rem; padding: 8px; text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Cargando sesiones...</div>';
      const res = await fetch('/api/partidas');
      if (!res.ok) throw new Error('Error al obtener partidas');
      const partidas = await res.json();

      dom.joinAvailableGamesList.innerHTML = '';
      if (!partidas || partidas.length === 0) {
        dom.joinAvailableGamesList.innerHTML = '<div style="color: #64748b; font-size: 0.8rem; padding: 8px; text-align: center;">No hay partidas activas en este momento.</div>';
        return;
      }

      partidas.forEach(p => {
        const item = document.createElement('div');
        item.className = 'join-session-item';
        const nombreLimpio = limpiarNombrePartida(p.nombre);
        item.innerHTML = `
          <div class="join-session-title" title="${nombreLimpio}">${nombreLimpio}</div>
          <span class="join-session-code">${p.codigo}</span>
        `;

        item.addEventListener('click', () => {
          dom.joinAvailableGamesList.querySelectorAll('.join-session-item').forEach(el => el.classList.remove('selected'));
          item.classList.add('selected');

          if (dom.joinCodeInput) {
            dom.joinCodeInput.value = p.codigo;
          }

          const savedName = localStorage.getItem('vtt_username');
          if (savedName && dom.joinUsernameInput && !dom.joinUsernameInput.value.trim()) {
            dom.joinUsernameInput.value = savedName;
          }

          if (dom.joinUsernameInput) {
            dom.joinUsernameInput.focus();
          }
        });

        dom.joinAvailableGamesList.appendChild(item);
      });
    } catch (err) {
      console.warn('Error al cargar lista de partidas para modal:', err);
      dom.joinAvailableGamesList.innerHTML = '<div style="color: #ef4444; font-size: 0.8rem; padding: 6px; text-align: center;">Error al cargar sesiones.</div>';
    }
  }

  async function handleImportSessionFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const backupData = JSON.parse(text);

      const username = (localStorage.getItem('vtt_username') || state.usuario?.nombre || '').trim();
      const userId = (localStorage.getItem('vtt_user_id') || state.usuario?.id || '').trim();
      if (userId) backupData.importerUserId = userId;
      if (username) backupData.importerUsername = username;

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

      // Auto unirse directo a la partida sin recargar
      joinGameDirect(data.codigo, username);
    } catch (err) {
      alert(`❌ Error al importar la sesión: ${err.message}`);
    } finally {
      e.target.value = '';
    }
  }

  // --- GESTIÓN DE AUTO-GUARDADO Y RESILIENCIA ANTE CAÍDAS ---
  // Motor de almacenamiento local: IndexedDB (soporte asíncrono para cientos de MB sin límite de localStorage)
  let idbSnapshotPromise = null;
  function getVttSnapshotDB() {
    if (!idbSnapshotPromise) {
      idbSnapshotPromise = new Promise((resolve) => {
        if (typeof window === 'undefined' || !window.indexedDB) {
          resolve(null);
          return;
        }
        try {
          const req = window.indexedDB.open('VTT_Snapshots_DB', 1);
          req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('snapshots')) {
              db.createObjectStore('snapshots', { keyPath: 'codigo' });
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch (_) {
          resolve(null);
        }
      });
    }
    return idbSnapshotPromise;
  }

  async function saveSnapshotToIndexedDB(codigo, data) {
    try {
      const db = await getVttSnapshotDB();
      if (!db) return false;
      return new Promise((resolve) => {
        const tx = db.transaction('snapshots', 'readwrite');
        const store = tx.objectStore('snapshots');
        store.put({
          codigo: codigo,
          guardado: Date.now(),
          snapshot: data
        });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (_) {
      return false;
    }
  }

  async function getSnapshotFromIndexedDB(codigo) {
    try {
      const db = await getVttSnapshotDB();
      if (!db) return null;
      return new Promise((resolve) => {
        const tx = db.transaction('snapshots', 'readonly');
        const store = tx.objectStore('snapshots');
        const req = store.get(codigo);
        req.onsuccess = () => resolve(req.result ? req.result.snapshot : null);
        req.onerror = () => resolve(null);
      });
    } catch (_) {
      return null;
    }
  }
  window.recuperarSnapshotLocal = getSnapshotFromIndexedDB;

  // Limpieza preventiva de claves pesadas antiguas en localStorage para liberar los ~5MB de cuota del origen
  function purgeLegacyLocalStorageMirrors() {
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('vtt_local_mirror_') || k.startsWith('vtt_mirror_'))) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => {
        try { localStorage.removeItem(k); } catch (_) { }
      });
    } catch (_) { }
  }

  let quotaWarningLogged = false;

  function saveLocalMirrorBackup() {
    if (!state.partida || !state.partida.codigo) return;
    const codigoPartida = state.partida.codigo;

    // Snapshot estructurado completo para IndexedDB (soporta imágenes, fichas y dibujos sin límite de 5MB)
    const mirrorData = {
      version: '2.1.0-local',
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

    // 1. Guardar de forma asíncrona en IndexedDB (no bloquea UI, cuota amplia de cientos de MB)
    saveSnapshotToIndexedDB(codigoPartida, mirrorData);

    // 2. Liberar espacio en localStorage eliminando blobs pesados acumulados
    purgeLegacyLocalStorageMirrors();

    // 3. Escribir únicamente un metadato ultra-ligero (<300 bytes) en localStorage para evitar QuotaExceededError
    try {
      const lightweightMeta = {
        version: '2.1.0-meta',
        codigo: codigoPartida,
        nombre: state.partida.nombre || '',
        fecha: new Date().toISOString(),
        totalFichas: (state.fichas || []).length,
        totalEscenas: (state.escenas || []).length
      };
      localStorage.setItem('vtt_session_meta_' + codigoPartida, JSON.stringify(lightweightMeta));
    } catch (e) {
      if (!quotaWarningLogged) {
        console.info('[VTT] Almacenamiento local optimizado mediante IndexedDB.');
        quotaWarningLogged = true;
      }
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

  async function descargarPartidaAlPc(partidaId, nombrePartida, codigoPartida) {
    if (!partidaId) return;
    try {
      showSaveIndicator('💾 Guardando...');
      showToast('💾 Generando archivo de guardado para tu PC...', 'info');

      const res = await fetch(`/api/partidas/${partidaId}/export`);
      if (!res.ok) throw new Error('Error del servidor al exportar sesión');

      const blob = await res.blob();
      const contentDisposition = res.headers.get('content-disposition');
      let filename = '';
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = match[1];
      }
      if (!filename) {
        const safeTitle = (nombrePartida || state.partida?.nombre || 'partida').replace(/[^a-zA-Z0-9_\-]/g, '_');
        const code = codigoPartida || state.partida?.codigo || 'BACKUP';
        filename = `sesion_dnd_${safeTitle}_${code}.json`;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast('✅ Partida y mapa guardados con éxito en tu PC.', 'success');
      showSaveIndicator('✅ Guardado en PC');
    } catch (err) {
      console.error('Error al guardar en PC:', err);
      showToast('❌ Error al guardar en PC: ' + err.message, 'danger');
    }
  }

  function handleEmergencyExport() {
    if (!state.partida) {
      alert('No hay partida activa para exportar.');
      return;
    }
    // Asegurar que las escenas exportadas incluyan sus mapas (especialmente la activa)
    const exportEscenas = (state.escenas || []).map(sc => {
      if (state.escenaActiva && sc.id === state.escenaActiva.id) {
        return { ...sc, mapa: state.escenaActiva.mapa };
      }
      return sc;
    });
    if (state.escenaActiva && !exportEscenas.some(sc => sc.id === state.escenaActiva.id)) {
      exportEscenas.push(state.escenaActiva);
    }

    const data = {
      version: '2.0.0-emergencia',
      fechaExport: new Date().toISOString(),
      partida: state.partida,
      escenas: exportEscenas,
      fichas: state.fichas,
      figuras: state.figuras,
      dibujos: state.dibujos,
      mensajes: state.mensajes,
      historial: state.historial,
      galeria: state.galeria
    };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeTitle = (state.partida.nombre || 'partida').replace(/[^a-zA-Z0-9_\-]/g, '_');
    a.download = `emergencia_${safeTitle}_${state.partida.codigo}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('💾 Copia de seguridad de emergencia descargada en tu PC.', 'success');
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
    if (window.innerWidth <= 900) {
      closeAllPanels();
    }
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
    if (dom.revHpBar) dom.revHpBar.checked = target.barra_hp !== undefined ? !!target.barra_hp : !!target.hp;
    dom.revHp.checked = !!target.hp;
    dom.revAc.checked = !!target.ac;
    dom.revNotas.checked = !!target.notas;
  }

  function closeModal(modal) {
    if (modal) modal.classList.add('hidden');
  }

  let vttLoadingTimeout = null;
  function showVttLoading(text) {
    const overlay = document.getElementById('vtt-loading-overlay');
    const txt = document.getElementById('vtt-loading-text');
    if (overlay) {
      if (txt && text) txt.textContent = text;
      overlay.classList.remove('hidden');
      overlay.style.opacity = '1';
      overlay.style.visibility = 'visible';
    }
    if (vttLoadingTimeout) clearTimeout(vttLoadingTimeout);
    vttLoadingTimeout = setTimeout(() => {
      hideVttLoading();
    }, 12000);
  }

  function hideVttLoading() {
    if (vttLoadingTimeout) clearTimeout(vttLoadingTimeout);
    const overlay = document.getElementById('vtt-loading-overlay');
    if (overlay) {
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.classList.add('hidden');
        overlay.style.visibility = 'hidden';
      }, 250);
    }
  }

  function showScreen(name) {
    closeAllPanels();
    if (name === 'start') {
      dom.screenStart?.classList.remove('hidden');
      dom.screenVTT?.classList.add('hidden');
      updateLobbyUserDisplay();
    } else {
      dom.screenStart?.classList.add('hidden');
      dom.screenVTT?.classList.remove('hidden');
      resizeCanvas();
      setTimeout(resizeCanvas, 50);
      setTimeout(resizeCanvas, 200);
    }
  }

  function joinGameDirect(codigo, nombreUsuario) {
    if (!codigo) return;
    codigo = codigo.toUpperCase().trim();
    nombreUsuario = (nombreUsuario || localStorage.getItem('vtt_username') || state.usuario?.nombre || '').trim();

    // Si aún no hay nombre de usuario, no permitir unirse a ciegas: pedir nombre al jugador
    if (!nombreUsuario) {
      if (dom.joinCodeInput) dom.joinCodeInput.value = codigo;
      if (dom.joinUsernameInput) dom.joinUsernameInput.value = '';
      loadJoinModalSessionsList();
      openModal(dom.modalJoinGame);
      setTimeout(() => dom.joinUsernameInput?.focus(), 150);
      return;
    }

    // Guardar en almacenamiento local para no perder la partida
    localStorage.setItem('vtt_active_game_code', codigo);
    localStorage.setItem('vtt_username', nombreUsuario);
    localStorage.setItem('vtt_username_explicit', '1');
    sessionStorage.setItem('vtt_in_session', '1');

    const deterministicId = 'usr_' + nombreUsuario.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
    state.usuario.id = deterministicId;
    state.usuario.nombre = nombreUsuario;
    localStorage.setItem('vtt_user_id', deterministicId);

    // Cerrar cualquier modal abierto
    if (dom.modalJoinGame) closeModal(dom.modalJoinGame);
    if (dom.modalCreateGame) closeModal(dom.modalCreateGame);

    // Si entramos a una partida distinta a la actual, limpiar vista anterior para evitar parpadeos
    if (!state.partida || state.partida.codigo !== codigo) {
      mapImage = null;
      mapImageLoaded = false;
      state.partida = null;
      state.escenaActiva = null;
      state.fichas = [];
      state.figuras = [];
      state.dibujos = [];
      if (dom.navGameTitle) dom.navGameTitle.textContent = 'Cargando sesión...';
      if (dom.currentSceneName) dom.currentSceneName.textContent = '...';
      markDirty();
    }

    // Llevar INMEDIATAMENTE a la pantalla VTT
    showScreen('vtt');
    if (dom.currentRoomCode) dom.currentRoomCode.textContent = codigo;
    showSaveIndicator('🟢 Entrando...');
    showVttLoading(`Entrando a la partida (${codigo})...`);

    // Asegurar que el socket esté inicializado y conectado
    if (!socket) {
      initSocket();
    }
    if (socket && !socket.connected) {
      try { socket.connect(); } catch (_) { }
    }

    // Emitir unirse_partida garantizando socket activo
    if (typeof window._emitWhenReady === 'function') {
      window._emitWhenReady('unirse_partida', {
        codigo,
        nombreUsuario,
        usuarioId: deterministicId
      });
    } else if (socket) {
      if (socket.connected) {
        socket.emit('unirse_partida', { codigo, nombreUsuario, usuarioId: deterministicId });
      } else {
        socket.once('connect', () => {
          socket.emit('unirse_partida', { codigo, nombreUsuario, usuarioId: deterministicId });
        });
      }
    }
  }
  window.joinGameDirect = joinGameDirect;

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

  // --- ARRANQUE SEGURO DE LA APLICACIÓN ---
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', startApp);
  } else {
    startApp();
  }

})();
