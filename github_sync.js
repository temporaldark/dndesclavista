/**
 * Módulo de Sincronización Automática con GitHub
 * Permite que Railway (o cualquier host en la nube) sincronice automáticamente
 * los archivos de guardado independientes (partida_*.json) directamente a tu repositorio de GitHub.
 */

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'temporaldark/dndesclavista';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

// Cola y debounce para no saturar la API de GitHub
const pendingGithubSyncTimers = new Map();
const lastSyncedHashes = new Map();

function isConfigured() {
  return Boolean(GITHUB_TOKEN && GITHUB_TOKEN.trim().length > 0);
}

// Helper para llamadas a GitHub API
async function githubRequest(endpoint, method = 'GET', body = null) {
  if (!isConfigured()) return null;

  const url = `https://api.github.com/repos/${GITHUB_REPO}${endpoint}`;
  const headers = {
    'Authorization': `Bearer ${GITHUB_TOKEN.trim()}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'VTT-Dnd-Sync-Bot',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  const options = { method, headers };
  if (body) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  if (response.status === 404) return null;

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API ${method} ${endpoint} [${response.status}]: ${errorText}`);
  }

  return await response.json();
}

/**
 * Subir o actualizar el archivo JSON de la partida en el repositorio de GitHub
 */
async function syncPartidaToGithub(codigo, partidaData) {
  if (!isConfigured() || !codigo || !partidaData) return false;

  const upperCode = codigo.toUpperCase();
  const filePath = `data/saves/partida_${upperCode}.json`;
  const nombre = partidaData.partida?.nombre || 'Partida';

  try {
    const jsonString = JSON.stringify(partidaData, null, 2);
    const contentBase64 = Buffer.from(jsonString, 'utf8').toString('base64');

    // 1. Obtener SHA del archivo existente en GitHub (si existe)
    let existingSha = null;
    try {
      const existing = await githubRequest(`/contents/${filePath}?ref=${GITHUB_BRANCH}`);
      if (existing && existing.sha) {
        existingSha = existing.sha;
      }
    } catch (_) {}

    // 2. Subir o actualizar el archivo en GitHub
    const payload = {
      message: `sync: actualizar partida ${upperCode} - "${nombre}"`,
      content: contentBase64,
      branch: GITHUB_BRANCH
    };
    if (existingSha) {
      payload.sha = existingSha;
    }

    console.log(`🐙 [GitHubSync] Sincronizando partida ${upperCode} ("${nombre}") en GitHub (${GITHUB_REPO})...`);
    await githubRequest(`/contents/${filePath}`, 'PUT', payload);
    console.log(`✅ [GitHubSync] ¡Partida ${upperCode} guardada exitosamente en GitHub!`);
    return true;
  } catch (err) {
    console.error(`❌ [GitHubSync] Error al sincronizar partida ${upperCode} en GitHub:`, err.message);
    return false;
  }
}

/**
 * Programar sincronización con GitHub usando debounce para no enviar peticiones por cada movimiento de token
 */
function scheduleGithubSync(codigo, partidaData, delayMs = 15000) {
  if (!isConfigured() || !codigo || !partidaData) return;

  const upperCode = codigo.toUpperCase();
  if (pendingGithubSyncTimers.has(upperCode)) {
    clearTimeout(pendingGithubSyncTimers.get(upperCode));
  }

  const timer = setTimeout(async () => {
    pendingGithubSyncTimers.delete(upperCode);
    await syncPartidaToGithub(upperCode, partidaData);
  }, delayMs);

  pendingGithubSyncTimers.set(upperCode, timer);
}

/**
 * Forzar sincronización inmediata de una partida con GitHub (ej: al salir de la sesión)
 */
async function syncPartidaImmediate(codigo, partidaData) {
  if (!isConfigured() || !codigo || !partidaData) return;
  const upperCode = codigo.toUpperCase();
  if (pendingGithubSyncTimers.has(upperCode)) {
    clearTimeout(pendingGithubSyncTimers.get(upperCode));
    pendingGithubSyncTimers.delete(upperCode);
  }
  return await syncPartidaToGithub(upperCode, partidaData);
}

/**
 * Eliminar el archivo de la partida en GitHub si se borra la partida
 */
async function deletePartidaFromGithub(codigo) {
  if (!isConfigured() || !codigo) return false;

  const upperCode = codigo.toUpperCase();
  const filePath = `data/saves/partida_${upperCode}.json`;

  try {
    const existing = await githubRequest(`/contents/${filePath}?ref=${GITHUB_BRANCH}`);
    if (!existing || !existing.sha) return false;

    await githubRequest(`/contents/${filePath}`, 'DELETE', {
      message: `sync: eliminar partida ${upperCode}`,
      sha: existing.sha,
      branch: GITHUB_BRANCH
    });
    console.log(`🗑️ [GitHubSync] Partida ${upperCode} eliminada de GitHub.`);
    return true;
  } catch (err) {
    console.error(`❌ [GitHubSync] Error al eliminar partida ${upperCode} de GitHub:`, err.message);
    return false;
  }
}

module.exports = {
  isConfigured,
  syncPartidaToGithub,
  scheduleGithubSync,
  syncPartidaImmediate,
  deletePartidaFromGithub,
  GITHUB_REPO,
  GITHUB_BRANCH
};
