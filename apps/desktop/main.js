import { app, BrowserWindow, Tray, Menu, nativeImage, shell, Notification, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

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

  // IPC: navigate to page from renderer
  ipcMain.on('navigate', (_e, page) => openWindow(page));
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
