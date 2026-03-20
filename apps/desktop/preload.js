import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('invariantDesktop', {
  // Receive live coherence updates pushed from main process
  onCoherenceUpdate: (callback) => {
    ipcRenderer.on('coherence-update', (_event, data) => callback(data));
  },
  // Navigate to a different page
  navigate: (page) => ipcRenderer.send('navigate', page),
  // Trigger update check from the UI
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  // Open GitHub OAuth in a popup window, avoids black screen
  startGitHubOAuth: () => ipcRenderer.send('start-github-oauth'),
  // Receive OAuth result (token) after popup closes
  onOAuthToken: (callback) => {
    ipcRenderer.once('oauth-token', (_event, data) => callback(data));
  },
  // Secure API key storage (uses safeStorage in main process)
  saveApiKey: (key) => ipcRenderer.invoke('save-api-key', key),
  loadApiKey: () => ipcRenderer.invoke('load-api-key'),
  clearApiKey: () => ipcRenderer.invoke('clear-api-key'),
  // App version
  getVersion: () => ipcRenderer.invoke('get-version'),
  // Deep link: receive open-trace event (invariant://open?trace=<id>)
  onOpenTrace: (callback) => ipcRenderer.on('open-trace', (_e, id) => callback(id)),
  // Deep link: receive open-action event (invariant://open?action=<id>)
  onOpenAction: (callback) => ipcRenderer.on('open-action', (_e, id) => callback(id)),
  // Is this running inside the desktop app?
  isDesktop: true,
});
