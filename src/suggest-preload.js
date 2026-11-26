const { contextBridge, ipcRenderer } = require('electron');

// The address-bar suggestion overlay only receives rows and reports a choice.
contextBridge.exposeInMainWorld('suggest', {
  onUpdate: (callback) => ipcRenderer.on('suggest:update', (_event, value) => callback(value)),
  choose: (index) => ipcRenderer.send('suggest:choose', index),
});
