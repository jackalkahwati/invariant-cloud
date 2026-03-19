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
  // Is this running inside the desktop app?
  isDesktop: true,
});
