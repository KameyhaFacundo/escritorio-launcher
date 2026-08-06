const { contextBridge, ipcRenderer } = require('electron');

// Puente mínimo entre el front (sandboxed, sin acceso a Node/Electron) y el
// proceso principal — hoy solo para imprimir el ticket directo a la
// impresora del sistema si hay una, sin mostrar el diálogo de impresión.
// window.electronAPI queda undefined en `pnpm dev` (navegador normal) y en
// demo mode, así que el front tiene que chequear que exista antes de usarlo.
contextBridge.exposeInMainWorld('electronAPI', {
  imprimirTicket: (html) => ipcRenderer.invoke('imprimir-ticket', html),
});
