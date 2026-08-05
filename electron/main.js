const { app, BrowserWindow, dialog } = require('electron');
const http = require('http');
const { ensureInitialized, startServer, stopServer, PORT } = require('./backend');
const { getLanIp } = require('./lan-ip');

let mainWindow = null;

function waitForServer(url, { timeoutMs = 30000, intervalMs = 300 } = {}) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`El backend no respondió en ${timeoutMs}ms`));
        } else {
          setTimeout(tryOnce, intervalMs);
        }
      });
    };
    tryOnce();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Stock Ferretería',
    autoHideMenuBar: true,
  });
  mainWindow.loadURL(`http://localhost:${PORT}/`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

function showLanIpNotice() {
  const ip = getLanIp();
  const address = ip ? `http://${ip}:${PORT}` : `(no se detectó una IP de LAN — revisá la conexión de red)`;
  dialog.showMessageBox({
    type: 'info',
    title: 'Conectar las cajas',
    message: 'Para conectar otra caja a este sistema, abrí un navegador ahí y entrá a:',
    detail: address,
    buttons: ['Listo'],
  });
}

async function boot() {
  try {
    ensureInitialized();
  } catch (err) {
    dialog.showErrorBox('No se pudo inicializar el sistema', String(err.message || err));
    app.quit();
    return;
  }

  startServer({
    onCrash: () => {
      if (mainWindow) {
        dialog.showErrorBox('El servidor se detuvo', 'Se va a reiniciar automáticamente.');
      }
    },
  });

  try {
    await waitForServer(`http://127.0.0.1:${PORT}/api/v1/health`);
  } catch (err) {
    dialog.showErrorBox('El servidor no arrancó', String(err.message || err));
    app.quit();
    return;
  }

  createWindow();
  showLanIpNotice();
}

app.whenReady().then(boot);

app.on('window-all-closed', () => {
  stopServer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopServer();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
