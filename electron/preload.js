const { contextBridge, ipcRenderer } = require('electron');

// Puente mínimo entre el front (sandboxed, sin acceso a Node/Electron) y el
// proceso principal — imprimir el ticket directo a la impresora del sistema
// sin mostrar el diálogo de impresión, y avisar cuando hay una actualización
// ya descargada y lista (ver 'app-update-listo' en main.js). window.electronAPI
// queda undefined en `pnpm dev` (navegador normal) y en demo mode, así que el
// front tiene que chequear que exista antes de usarlo.
contextBridge.exposeInMainWorld('electronAPI', {
  imprimirTicket: (html) => ipcRenderer.invoke('imprimir-ticket', html),
  // Si no hay impresora física, el front baja el ticket como PDF en vez de
  // depender del diálogo de impresión — ver 'generar-ticket-pdf' en main.js.
  generarTicketPdf: (html) => ipcRenderer.invoke('generar-ticket-pdf', html),
  onUpdateListo: (callback) => ipcRenderer.on('app-update-listo', () => callback()),
  // Backup en la nube, 100% opcional — ver Configuración en el front y
  // electron/gdrive.js. driveConectar() se queda esperando hasta que el
  // dueño del comercio termine de aprobar el acceso en el navegador (o
  // cancele), puede tardar.
  driveConectado: () => ipcRenderer.invoke('drive-conectado'),
  driveEmail: () => ipcRenderer.invoke('drive-email'),
  driveConectar: () => ipcRenderer.invoke('drive-conectar'),
  driveDesconectar: () => ipcRenderer.invoke('drive-desconectar'),
  // Fecha real del último backup (automático o manual, es el mismo archivo)
  // — antes el front solo sabía de los manuales, vía localStorage.
  ultimoBackupInfo: () => ipcRenderer.invoke('ultimo-backup-info'),
  // Dispara el mismo backup automático (comprime + sube a Drive si está
  // conectado) a pedido, sin esperar al horario programado — ver
  // 'ejecutar-backup-ahora' en main.js.
  ejecutarBackupAhora: () => ipcRenderer.invoke('ejecutar-backup-ahora'),
  // Restaurar desde un .gz elegido a mano — reemplaza la base entera, para
  // en caso de cambio de PC o pérdida de datos. Ver RESTAURAR-BACKUP.md
  // (esto automatiza ese mismo procedimiento manual).
  restaurarBackup: () => ipcRenderer.invoke('restaurar-backup'),
});
