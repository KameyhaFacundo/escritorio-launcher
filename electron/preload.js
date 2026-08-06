const { contextBridge, ipcRenderer } = require('electron');

// Puente mínimo entre el front (sandboxed, sin acceso a Node/Electron) y el
// proceso principal — imprimir el ticket directo a la impresora del sistema
// sin mostrar el diálogo de impresión, y avisar cuando hay una actualización
// ya descargada y lista (ver 'app-update-listo' en main.js). window.electronAPI
// queda undefined en `pnpm dev` (navegador normal) y en demo mode, así que el
// front tiene que chequear que exista antes de usarlo.
contextBridge.exposeInMainWorld('electronAPI', {
  imprimirTicket: (html) => ipcRenderer.invoke('imprimir-ticket', html),
  onUpdateListo: (callback) => ipcRenderer.on('app-update-listo', () => callback()),
});
