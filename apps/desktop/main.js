import { app, BrowserWindow, Tray, Menu, nativeImage, shell, Notification, ipcMain, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
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

// ── Tray icon ──────────────────────────────────────────────────────────────

function createTrayIcon(score) {
  // 16×16 monochrome template image drawn with canvas-like approach via nativeImage
  // We use a simple text-based tray — macOS renders it correctly
  const label = score !== null ? `Φ ${score.toFixed(1)}` : 'Φ —';
  return label;
}

function buildTrayMenu(coherence) {
  const scoreLabel = coherence
    ? `Score: ${coherence.coherenceScore.toFixed(1)}  ·  Φ = ${coherence.phi.toFixed(3)}`
    : 'Not connected';

  return Menu.buildFromTemplate([
    {
      label: 'Invariant',
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
      label: 'Change API endpoint…',
      click: () => openWindow('account.html'),
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

async function pollCoherence() {
  try {
    const res = await fetch(`${API_BASE}/world/coherence`, {
      headers: { 'X-API-Key': process.env['INVARIANT_API_KEY'] ?? 'dev-api-key' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Notify if coherence drops sharply
    if (lastCoherence !== null && data.coherenceScore < lastCoherence - 10) {
      new Notification({
        title: 'Invariant — Coherence Drop',
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

    return data;
  } catch {
    if (tray) {
      tray.setTitle('Φ —');
      tray.setContextMenu(buildTrayMenu(null));
    }
    return null;
  }
}

// ── Auto-updater ──────────────────────────────────────────────────────────

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    new Notification({
      title: 'Invariant Update Available',
      body: `Version ${info.version} is ready to download.`,
    }).show();

    if (tray) tray.setContextMenu(buildTrayMenuWithUpdate(info.version));

    dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `Invariant ${info.version} is available`,
      detail: `You're on ${app.getVersion()}. Download and install now?`,
      buttons: ['Download & Install', 'Later'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.downloadUpdate();
    });
  });

  autoUpdater.on('update-downloaded', () => {
    new Notification({
      title: 'Invariant — Update Ready',
      body: 'Restart to apply the update.',
    }).show();

    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: 'Update downloaded',
      detail: 'Restart Invariant to apply the update.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err.message);
  });
}

function buildTrayMenuWithUpdate(version) {
  const items = buildTrayMenu(null).items;
  return Menu.buildFromTemplate([
    {
      label: `⬆ Update to ${version} available — click to install`,
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
  autoUpdater.checkForUpdates().catch(err => {
    if (manual) dialog.showMessageBox({ type: 'error', title: 'Update Check Failed', message: err.message });
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Hide from dock — menubar-only app
  app.dock?.hide();

  // Create tray
  const icon = nativeImage.createFromPath(
    path.join(__dirname, 'assets/tray-icon.png')
  );
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setTitle('Φ —');
  tray.setToolTip('Invariant — coherence layer');
  tray.setContextMenu(buildTrayMenu(null));

  tray.on('double-click', () => openWindow('dashboard.html'));

  // Initial poll then every 5s
  await pollCoherence();
  pollInterval = setInterval(pollCoherence, 5000);

  // Auto-updater: setup and check 5s after launch (gives app time to settle)
  setupAutoUpdater();
  setTimeout(() => checkForUpdates(), 5000);

  // IPC: navigate to page from renderer
  ipcMain.on('navigate', (_e, page) => openWindow(page));
  // IPC: check for updates from renderer
  ipcMain.on('check-for-updates', () => checkForUpdates(true));
});

app.on('window-all-closed', (e) => {
  // Keep running in menubar even when all windows closed
  e.preventDefault();
});

app.on('before-quit', () => {
  if (pollInterval) clearInterval(pollInterval);
});

app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) openWindow('dashboard.html');
});
