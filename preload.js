const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('x4api', {
  importSave: () => ipcRenderer.invoke('save:import'),
  exportSave: (payload) => ipcRenderer.invoke('save:export', payload),
  loadDictionaries: () => ipcRenderer.invoke('dict:load')
});
