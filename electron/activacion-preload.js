const { contextBridge, ipcRenderer } = require('electron');

// Puente mínimo para la pantalla de activación — separado de preload.js
// (el de la app normal) porque esta ventana carga un HTML estático propio,
// sin nada del front de React.
contextBridge.exposeInMainWorld('licenseAPI', {
  onDeviceCode: (callback) => ipcRenderer.on('device-code', (_event, code) => callback(code)),
  activar: (datos) => ipcRenderer.invoke('activar-licencia', datos),
});
