# ⚔️ VTT D&D 5e - Virtual Tabletop Multijugador Homebrew

Un Virtual Tabletop (VTT) completo para **Dungeons & Dragons 5a Edición** con soporte para contenido Homebrew y multijugador en tiempo real desde cualquier navegador web en PC y móviles.

---

## 🎯 CARACTERÍSTICAS PRINCIPALES

- **Tablero interactivo (Canvas VTT):**
  - Grid personalizable (hasta 500x500 casillas) con escala en pies.
  - Subida de mapas de fondo (JPG, PNG, WEBP).
  - Movimiento de fichas por arrastrar y soltar (**drag & drop en PC** y **táctil en móvil**).
  - Encajado automático en el grid (*snap-to-grid*).
  - Zoom dinámico (rueda del ratón, gestos táctiles pinch-to-zoom y botones flotantes).
  - **Forma de Gigante:** Toggle instantáneo que multiplica x2/x3 el tamaño del token.

- **Herramientas exclusivas del Dungeon Master (DM):**
  - **Medición de distancia:** cálculo en pies en tiempo real entre dos puntos del grid.
  - **Dibujo libre:** pincel con selector de color y grosor.
  - **Áreas de efecto / Figuras:** creación de Círculos, Cuadrados y Conos de ataque con etiquetas, opacidad y color.
  - **Aplicador rápido de daño y curación.**
  - **Ocultamiento de Monstruos:** los jugadores solo ven la silueta del token y los valores de HP y AC como `"???"`.
  - **Galería de Plantillas:** guardar fichas de monstruos/NPCs reutilizables.

- **Lanzador de Dados Avanzado:**
  - Soporte para fórmulas complejas personalizadas (ej: `2d10+6+1d6`, `1d20+5`, `3d6+1d4-2`).
  - Botones de acceso rápido para dados estándar (`d4`, `d6`, `d8`, `d10`, `d12`, `d20`, `d100`).
  - Toggles de **Ventaja / Desventaja** para `d20`.
  - Animación del resultado flotando sobre la ficha en el mapa.
  - Historial de tiradas exportable a JSON.

- **Chat en Tiempo Real con GIFs:**
  - Mensajes sincronizados por Socket.io.
  - Colores únicos asignados por usuario.
  - Galería integrada de GIFs de reacción temáticos de D&D.
  - **Centrado automático:** haz clic en el nombre de cualquier jugador en el chat para centrar el mapa sobre su ficha.

- **Persistencia en SQLite (`vtt.db`):**
  - Base de datos ligera alojada en un solo archivo `/data/vtt.db`.
  - Guardado automático cada 10 segundos e indicador visual.
  - Gestión de múltiples partidas con código único de 6 caracteres (ej: `3E93X`).

---

## 💻 REQUISITOS PREVIOS E INSTALACIÓN LOCAL

### 1. Requisitos:
- Node.js versión 16 o superior.

### 2. Pasos de Instalación:
```bash
# Entrar al directorio del proyecto
cd C:\Users\Rodri\.gemini\antigravity\scratch\vtt-app

# Instalar dependencias
npm install

# Iniciar el servidor
npm start
```

Abre tu navegador en: **`http://localhost:3000`**

---

## 🚀 DESPLIEGUE EN RAILWAY

El proyecto viene preparado de fábrica para desplegar en [Railway](https://railway.app/):

1. Sube este repositorio a tu cuenta de **GitHub**.
2. Entra a Railway y selecciona **New Project -> Deploy from GitHub repo**.
3. Selecciona este repositorio. Railway detectará automáticamente el entorno de Node.js.
4. En **Variables de Entorno**, configura (opcional):
   - `PORT` = `3000` (Railway asigna automáticamente `$PORT`).
5. ¡Listo! Tendrás un enlace público HTTPS para compartir el código de partida con tus amigos.

---

## 🛠️ ESTRUCTURA DEL PROYECTO

```
/vtt-app
├── server.js          # Servidor Express + Socket.io + REST API
├── database.js        # Configuración de SQLite y consultas async
├── package.json       # Configuración de dependencias
├── /public
│   ├── index.html     # Interfaz principal responsive y modales
│   ├── style.css      # Estilos temáticos D&D 5e (mobile-first)
│   └── app.js         # Motor JavaScript cliente (Canvas, Sockets, Dados, Chat)
├── /data
│   └── vtt.db         # Base de datos SQLite (se genera automáticamente)
└── README.md          # Documentación del proyecto
```
