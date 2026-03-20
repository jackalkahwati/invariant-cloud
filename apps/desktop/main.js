import { app, BrowserWindow, Tray, Menu, nativeImage, shell, Notification, ipcMain, dialog, safeStorage } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { autoUpdater } = require('electron-updater');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes('--dev');

// Path to the built web pages
const WEB_DIR = isDev
  ? path.join(__dirname, '../../apps/web')
  : path.join(process.resourcesPath, 'apps/web');

const API_BASE = process.env['INVARIANT_API'] ?? 'http://localhost:3000';

let tray = null;
let mainWindow = null;
let pollInterval = null;
let lastCoherence = null;
let lastUpdateCheckWasManual = false;
let usingSse = false;
let sseAbortController = null;

// ── Secure API key storage ────────────────────────────────────────────────

function getEncKeyPath() {
  return path.join(app.getPath('userData'), 'inv_api_key.enc');
}

function saveApiKey(key) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('System encryption not available');
  }
  const encrypted = safeStorage.encryptString(key);
  fs.writeFileSync(getEncKeyPath(), encrypted);
}

function loadApiKey() {
  const keyPath = getEncKeyPath();
  if (!fs.existsSync(keyPath)) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const encrypted = fs.readFileSync(keyPath);
    return safeStorage.decryptString(encrypted);
  } catch {
    return null;
  }
}

function clearApiKey() {
  const keyPath = getEncKeyPath();
  if (fs.existsSync(keyPath)) {
    fs.unlinkSync(keyPath);
  }
}

// ── Tray icon ──────────────────────────────────────────────────────────────

function createTrayIcon(score) {
  // 16×16 monochrome template image drawn with canvas-like approach via nativeImage
  // We use a simple text-based tray, macOS renders it correctly
  const label = score !== null ? `Φ ${score.toFixed(1)}` : 'Φ';
  return label;
}

function buildTrayMenu(coherence) {
  const scoreLabel = coherence
    ? `Score: ${coherence.coherenceScore.toFixed(1)}  ·  Φ = ${coherence.phi.toFixed(3)}`
    : 'Not connected';

  const modeLabel = usingSse ? 'Invariant, live' : 'Invariant, polling';

  return Menu.buildFromTemplate([
    {
      label: modeLabel,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: scoreLabel,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Open Dashboard',
      click: () => openWindow('dashboard.html'),
    },
    {
      label: 'World State',
      click: () => openWindow('dashboard.html'),
    },
    {
      label: 'Actions & Audit',
      click: () => openWindow('audit.html'),
    },
    {
      label: 'Constraints',
      click: () => openWindow('constraints.html'),
    },
    { type: 'separator' },
    {
      label: `API: ${API_BASE}`,
      enabled: false,
    },
    {
      label: 'Settings…',
      click: () => openWindow('settings.html'),
    },
    { type: 'separator' },
    {
      label: 'Check for Updates…',
      click: () => checkForUpdates(true),
    },
    {
      label: `Version ${app.getVersion()}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Quit Invariant',
      accelerator: 'Cmd+Q',
      click: () => app.quit(),
    },
  ]);
}

// ── Main window ───────────────────────────────────────────────────────────

function openWindow(page = 'dashboard.html') {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadFile(path.join(WEB_DIR, page));
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0b1326',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(WEB_DIR, page));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── Coherence polling ─────────────────────────────────────────────────────

function handleCoherenceData(data) {
  // Notify if coherence drops sharply
  if (lastCoherence !== null && data.coherenceScore < lastCoherence - 10) {
    new Notification({
      title: 'Invariant, Coherence Drop',
      body: `Score fell from ${lastCoherence.toFixed(1)} → ${data.coherenceScore.toFixed(1)}. Check for new contradictions.`,
      silent: false,
    }).show();
  }

  lastCoherence = data.coherenceScore;

  // Update tray title
  if (tray) {
    tray.setTitle(`Φ ${data.coherenceScore.toFixed(1)}`);
    tray.setContextMenu(buildTrayMenu(data));
  }

  // Push to any open window
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('coherence-update', data);
  }
}

async function pollCoherence() {
  try {
    const res = await fetch(`${API_BASE}/world/coherence`, {
      headers: { 'X-API-Key': process.env['INVARIANT_API_KEY'] ?? 'dev-api-key' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    handleCoherenceData(data);
    return data;
  } catch {
    if (tray) {
      tray.setTitle('Φ');
      tray.setContextMenu(buildTrayMenu(null));
    }
    return null;
  }
}

// ── SSE streaming ─────────────────────────────────────────────────────────

async function connectSse() {
  if (sseAbortController) {
    sseAbortController.abort();
  }
  sseAbortController = new AbortController();

  try {
    const res = await fetch(`${API_BASE}/world/stream`, {
      headers: {
        'X-API-Key': process.env['INVARIANT_API_KEY'] ?? 'dev-api-key',
        'Accept': 'text/event-stream',
      },
      signal: sseAbortController.signal,
    });

    if (!res.ok || !res.body) {
      throw new Error(`SSE HTTP ${res.status}`);
    }

    // SSE connected, pause polling
    usingSse = true;
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }

    // Update tray tooltip to show live mode
    if (tray) {
      tray.setToolTip('Invariant, live');
      tray.setContextMenu(buildTrayMenu(lastCoherence ? { coherenceScore: lastCoherence, phi: 0 } : null));
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data:')) {
          const raw = line.slice(5).trim();
          if (!raw || raw === '[DONE]') continue;
          try {
            const data = JSON.parse(raw);
            handleCoherenceData(data);
          } catch {
            // malformed JSON, skip
          }
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') return; // intentional abort, don't reconnect
    // SSE failed, fall back to polling
  }

  // Fall back to polling if SSE ends unexpectedly
  usingSse = false;
  if (tray) {
    tray.setToolTip('Invariant, polling');
  }
  if (!pollInterval) {
    pollInterval = setInterval(pollCoherence, 5000);
  }

  // Retry SSE after 10s
  setTimeout(connectSse, 10000);
}

// ── Auto-updater ──────────────────────────────────────────────────────────

function setupAutoUpdater() {
  // Download silently in background, user only sees a restart prompt
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Use invariant.me as the update feed (avoids GitHub private repo auth issues)
  autoUpdater.setFeedURL({ provider: 'generic', url: 'https://invariant.me/updates' });

  autoUpdater.on('update-available', (info) => {
    // Just update the tray to show update banner, download starts automatically
    if (tray) tray.setContextMenu(buildTrayMenuWithUpdate(info.version));
  });

  autoUpdater.on('update-downloaded', (info) => {
    new Notification({
      title: 'Invariant update ready',
      body: `v${info.version} downloaded, restart to install.`,
    }).show();

    // Refresh app menu so "Check for Updates" shows "Restart to Update"
    setAppMenu(info.version);

    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: `Invariant ${info.version} is ready`,
      detail: 'The update has been downloaded. Restart now to install it.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('update-not-available', () => {
    setAppMenu();
    if (lastUpdateCheckWasManual) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Up to Date',
        message: `Invariant ${app.getVersion()} is the latest version.`,
      });
      lastUpdateCheckWasManual = false;
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err.message);
    if (lastUpdateCheckWasManual) {
      dialog.showMessageBox({
        type: 'error',
        title: 'Update Failed',
        message: 'Could not check for updates.',
        detail: err.message,
      });
      lastUpdateCheckWasManual = false;
    }
  });
}

function buildTrayMenuWithUpdate(version) {
  const items = buildTrayMenu(null).items;
  return Menu.buildFromTemplate([
    {
      label: `⬆ Update to ${version} available, click to install`,
      click: () => autoUpdater.downloadUpdate(),
    },
    { type: 'separator' },
    ...items.map(i => ({ label: i.label, enabled: i.enabled, type: i.type, click: i.click, accelerator: i.accelerator })),
  ]);
}

function checkForUpdates(manual = false) {
  if (isDev) {
    if (manual) dialog.showMessageBox({ type: 'info', title: 'Updates', message: 'Updates disabled in dev mode.' });
    return;
  }
  lastUpdateCheckWasManual = manual;
  autoUpdater.checkForUpdates().catch(err => {
    lastUpdateCheckWasManual = false;
    if (manual) dialog.showMessageBox({ type: 'error', title: 'Update Check Failed', message: err.message });
  });
}

// ── Native macOS app menu ─────────────────────────────────────────────────

function setAppMenu(pendingVersion = null) {
  const updateItem = pendingVersion
    ? { label: `Restart to Update to ${pendingVersion}…`, click: () => autoUpdater.quitAndInstall() }
    : { label: 'Check for Updates…', click: () => checkForUpdates(true) };

  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { label: `About Invariant`, role: 'about' },
        { type: 'separator' },
        updateItem,
        { label: `Version ${app.getVersion()}`, enabled: false },
        { type: 'separator' },
        { label: 'Settings…', click: () => openWindow('settings.html') },
        { label: 'Change API Endpoint…', click: () => openWindow('account.html') },
        { type: 'separator' },
        { label: 'Hide Invariant', role: 'hide' },
        { label: 'Hide Others', role: 'hideOthers' },
        { type: 'separator' },
        { label: 'Quit Invariant', role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'World State', click: () => openWindow('dashboard.html') },
        { label: 'Actions & Audit', click: () => openWindow('audit.html') },
        { label: 'Constraints', click: () => openWindow('constraints.html') },
        { label: 'Trace Explorer', click: () => openWindow('trace.html') },
        { type: 'separator' },
        { label: 'Settings…', click: () => openWindow('settings.html') },
      ],
    },
    {
      label: 'Window',
      role: 'windowMenu',
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Documentation…', click: () => shell.openExternal('https://invariant.me/docs.html') },
        { label: 'API Reference…', click: () => shell.openExternal('https://invariant.me/docs.html#api-reference') },
        { type: 'separator' },
        { label: 'invariant.me…', click: () => shell.openExternal('https://invariant.me') },
      ],
    },
  ]);

  Menu.setApplicationMenu(menu);
}

// ── Deep link protocol ────────────────────────────────────────────────────

// Register invariant:// protocol handler
app.setAsDefaultProtocolClient('invariant');

function handleDeepLink(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'invariant:') return;
    // invariant://open?page=dashboard → open page
    // invariant://open?trace=<id> → open dashboard, send IPC open-trace
    // invariant://open?action=<id> → open audit.html, send IPC open-action
    if (parsed.hostname === 'open') {
      const page = parsed.searchParams.get('page');
      const traceId = parsed.searchParams.get('trace');
      const actionId = parsed.searchParams.get('action');

      if (traceId) {
        openWindow('dashboard.html');
        // Wait for window to load before sending IPC
        const sendTrace = () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('open-trace', traceId);
          }
        };
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.once('did-finish-load', sendTrace);
          // Also try immediately in case already loaded
          setTimeout(sendTrace, 500);
        } else {
          setTimeout(sendTrace, 1000);
        }
      } else if (actionId) {
        openWindow('audit.html');
        const sendAction = () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('open-action', actionId);
          }
        };
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.once('did-finish-load', sendAction);
          setTimeout(sendAction, 500);
        } else {
          setTimeout(sendAction, 1000);
        }
      } else if (page) {
        openWindow(`${page}.html`);
      }
    }
  } catch (err) {
    console.error('Deep link parse error:', err.message);
  }
}

// macOS: handle deep links via open-url event
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// Windows/Linux: handle deep links passed as argv
app.on('second-instance', (_event, argv) => {
  const url = argv.find(arg => arg.startsWith('invariant://'));
  if (url) handleDeepLink(url);
  // Focus existing window if open
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ── App lifecycle ─────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Hide from dock, menubar-only app
  app.dock?.hide();

  // Load saved API key into env before anything else
  try {
    const savedKey = loadApiKey();
    if (savedKey) {
      process.env['INVARIANT_API_KEY'] = savedKey;
    }
  } catch (err) {
    console.error('Could not load saved API key:', err.message);
  }

  // Set native macOS app menu (Invariant > Check for Updates…)
  setAppMenu();

  // Create tray
  const icon = nativeImage.createFromPath(
    path.join(__dirname, 'assets/tray-icon.png')
  );
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setTitle('Φ');
  tray.setToolTip('Invariant, polling');
  tray.setContextMenu(buildTrayMenu(null));

  tray.on('double-click', () => openWindow('dashboard.html'));

  // Initial poll then try SSE; fall back to setInterval if SSE fails
  await pollCoherence();

  // Try SSE first, connectSse() manages fallback to polling internally
  connectSse().catch(() => {
    // If connectSse throws synchronously (shouldn't happen), fall back
    if (!pollInterval) {
      pollInterval = setInterval(pollCoherence, 5000);
    }
  });

  // If SSE hasn't paused polling within 3s, start polling interval
  setTimeout(() => {
    if (!usingSse && !pollInterval) {
      pollInterval = setInterval(pollCoherence, 5000);
    }
  }, 3000);

  // Auto-updater: setup and check 5s after launch (gives app time to settle)
  setupAutoUpdater();
  setTimeout(() => checkForUpdates(), 5000);

  // ── IPC handlers ────────────────────────────────────────────────────────

  // Navigate to page from renderer
  ipcMain.on('navigate', (_e, page) => openWindow(page));

  // Check for updates from renderer
  ipcMain.on('check-for-updates', () => checkForUpdates(true));

  // App version
  ipcMain.handle('get-version', () => app.getVersion());

  // Secure API key storage
  ipcMain.handle('save-api-key', (_e, key) => {
    saveApiKey(key);
    // Also set in current process env so polling/SSE uses it immediately
    process.env['INVARIANT_API_KEY'] = key;
    return { ok: true };
  });

  ipcMain.handle('load-api-key', () => {
    return loadApiKey();
  });

  ipcMain.handle('clear-api-key', () => {
    clearApiKey();
    delete process.env['INVARIANT_API_KEY'];
    return { ok: true };
  });

  // GitHub OAuth, open popup so main window doesn't navigate away
  ipcMain.on('start-github-oauth', (event) => {
    const OAUTH_URL = 'https://invariant-engine.vercel.app/auth/github';
    const popup = new BrowserWindow({
      width: 600,
      height: 700,
      title: 'Sign in with GitHub',
      parent: mainWindow ?? undefined,
      modal: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    popup.loadURL(OAUTH_URL);

    // Watch for the callback redirect to account.html?token=...
    popup.webContents.on('will-redirect', (_e, url) => {
      const parsed = new URL(url);
      const token = parsed.searchParams.get('token');
      const apiKey = parsed.searchParams.get('apiKey');
      if (token) {
        // Send token back to the renderer that asked for OAuth
        const sender = BrowserWindow.fromWebContents(event.sender);
        if (sender && !sender.isDestroyed()) {
          sender.webContents.send('oauth-token', { token, apiKey });
        }
        popup.close();
      }
    });

    // Also check page loads (some redirects land without will-redirect)
    popup.webContents.on('did-navigate', (_e, url) => {
      const parsed = new URL(url);
      const token = parsed.searchParams.get('token');
      const apiKey = parsed.searchParams.get('apiKey');
      if (token) {
        const sender = BrowserWindow.fromWebContents(event.sender);
        if (sender && !sender.isDestroyed()) {
          sender.webContents.send('oauth-token', { token, apiKey });
        }
        popup.close();
      }
    });
  });
});

app.on('window-all-closed', (e) => {
  // Keep running in menubar even when all windows closed
  e.preventDefault();
});

app.on('before-quit', () => {
  if (pollInterval) clearInterval(pollInterval);
  if (sseAbortController) sseAbortController.abort();
});

app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) openWindow('dashboard.html');
});
