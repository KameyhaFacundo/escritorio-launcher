const { app, BrowserWindow, dialog, shell, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const http = require('http');
const path = require('path');
const {
  ensureInitialized, startServer, stopServer, PORT,
  startQueueWorker, stopQueueWorker,
  startBackupScheduler, stopBackupScheduler,
} = require('./backend');
const { getLanIp } = require('./lan-ip');
const { obtenerCodigoDispositivo, licenciaValida, activar } = require('./license');

// Fija el nombre explícito (en vez de dejar que Electron infiera uno del
// package.json, que da resultados distintos en dev vs empaquetado) — de esto
// depende app.getPath('userData'), o sea dónde vive la base real del
// comercio. Sin tilde/espacios a propósito: es más seguro para pegar en
// rutas manuales (PowerShell, scripts de soporte) sin problemas de encoding.
app.setName('StockFerreteria');

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

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Stock Ferretería',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Sin esto, cualquier window.open() del front (WhatsApp en Clientes, Google
  // OAuth, el callback de Mercado Pago, etc.) queda bloqueado en silencio:
  // Electron no le abre una ventana propia a un link externo por default.
  // Pero no todo window.open() es un link externo — imprimirTicket.js abre
  // una ventana EN BLANCO (sin URL) para escribirle el HTML del ticket a
  // mano y dispararle print() ahí mismo; a esa hay que dejarla pasar como
  // ventana normal de Electron, si no "no se puede abrir la ventana de
  // impresión" (que era exactamente lo que pasaba cuando esto denegaba todo
  // sin distinguir). Solo los links http(s) de verdad se mandan afuera.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // index.html no tiene hash de contenido en el nombre (a diferencia de los
  // .js/.css en /assets/*) — sin esto, el caché HTTP de Chromium lo sirve tal
  // cual entre reinicios y una actualización de la app (nuevo build copiado a
  // resources/) puede no verse nunca, aunque los assets nuevos sí estén en
  // disco. Se limpia en cada arranque, no solo la primera vez.
  await mainWindow.webContents.session.clearCache();
  mainWindow.loadURL(`http://localhost:${PORT}/`, { extraHeaders: 'pragma: no-cache\ncache-control: no-cache\n' });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// Imprime el ticket directo a la impresora del sistema, sin mostrar el
// diálogo de impresión — solo si hay al menos una impresora instalada. Si no
// hay ninguna, devuelve printed:false y el front cae al flujo de siempre
// (ventana con el ticket, para que lo impriman a mano o solo lo vean).
async function imprimirTicketDirecto(html) {
  const printers = await mainWindow?.webContents.getPrintersAsync().catch(() => []) ?? [];
  if (!printers.length) return { printed: false };

  const win = new BrowserWindow({ show: false });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await new Promise((resolve, reject) => {
      win.webContents.print({ silent: true, printBackground: true }, (success, reason) => {
        success ? resolve() : reject(new Error(reason || 'No se pudo imprimir'));
      });
    });
    return { printed: true };
  } catch (err) {
    return { printed: false, error: err.message };
  } finally {
    if (!win.isDestroyed()) win.close();
  }
}

ipcMain.handle('imprimir-ticket', (_event, html) => imprimirTicketDirecto(html));

// Chequea una sola vez, al arrancar — nunca en medio de una sesión, para no
// interrumpir una venta. Se descarga sola en segundo plano si hay una
// versión nueva y se instala recién la próxima vez que se cierra el
// programa (autoInstallOnAppQuit), reutilizando el mismo apagado ordenado
// de stopServer()/stopQueueWorker() de más abajo. El repo de GitHub es
// público, así que no hace falta ningún token para chequear ni descargar.
function checkForAppUpdates() {
  if (!app.isPackaged) return; // en dev no hay instalador ni feed de releases

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // "Reiniciar ahora" además de "Más tarde" — con solo "Entendido" (como
  // estaba antes), la instalación quedaba pendiente para quien sabe cuándo
  // se cierre el programa, ya lejos de haber leído este aviso: si en ese
  // momento alguien reabre rápido, pega justo en los segundos en que NSIS
  // está reemplazando el .exe y Windows tira "no puede encontrar el
  // archivo". Reiniciar ya mismo acota esa ventana a un momento en el que
  // el usuario sabe que está pasando.
  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Actualización lista',
      message: 'Hay una versión nueva de Stock Ferretería.',
      detail: 'Se recomienda reiniciar ahora para instalarla. Si elegís "Más tarde", se va a instalar sola la próxima vez que cierres el programa — en ese momento esperá unos segundos antes de volver a abrirla.',
      buttons: ['Reiniciar ahora', 'Más tarde'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  // Sin internet o el feed sin responder no tiene que afectar el uso normal
  // de la app — mismo criterio que el resto del sistema (ver ArcaService).
  autoUpdater.on('error', (err) => {
    console.error('Chequeo de actualizaciones falló:', err?.message || err);
  });

  autoUpdater.checkForUpdates().catch(() => {}); // ya lo loguea el 'error' de arriba
}

// Ya no se muestra sola al arrancar (interrumpía cada apertura de la app con
// un diálogo nativo de Windows que además desentonaba con el resto de la UI
// tematizada) — ahora vive como botón "Conectar otra caja" en Configuración
// > Negocio, resuelto del lado del backend (SistemaController::lanIp) para
// no necesitar un puente IPC con Electron. getLanIp() se deja sin usar acá
// por si en algún momento hace falta volver al diálogo nativo.
// eslint-disable-next-line no-unused-vars
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

// Ventana chica y propia (HTML estático, no el front de React — no hace
// falta levantar el backend solo para pedir un código) que bloquea el
// arranque hasta que esta PC tenga un código de activación válido. Se
// resuelve en false si el usuario cierra la ventana sin activar (ahí
// boot() corta y cierra la app, no tiene sentido seguir sin activación).
function ensureLicensed() {
  if (licenciaValida()) return Promise.resolve(true);

  return new Promise((resolve) => {
    let activado = false;
    const deviceCode = obtenerCodigoDispositivo();

    // handle (no handleOnce): si el cliente tipea mal el código, tiene que
    // poder reintentar sin que el canal quede sordo después del primer intento.
    ipcMain.handle('activar-licencia', (_event, codigoIngresado) => {
      const ok = activar(codigoIngresado);
      if (ok) {
        activado = true;
        actWin.close();
      }
      return ok;
    });

    const actWin = new BrowserWindow({
      width: 480, height: 480, resizable: false, autoHideMenuBar: true,
      title: 'Activación requerida',
      webPreferences: { preload: path.join(__dirname, 'activacion-preload.js') },
    });
    actWin.loadFile(path.join(__dirname, 'activacion.html'));
    actWin.webContents.once('did-finish-load', () => {
      actWin.webContents.send('device-code', deviceCode);
    });
    actWin.on('closed', () => {
      ipcMain.removeHandler('activar-licencia');
      resolve(activado);
    });
  });
}

async function boot() {
  const licenciado = await ensureLicensed();
  if (!licenciado) { app.quit(); return; }

  // Recién de acá para abajo tiene sentido que cerrar todas las ventanas
  // cierre la app entera — si esto se registrara desde el arranque, cerrar
  // la ventana de activación (que dispara el mismo evento) mataría la app
  // apenas activás bien, antes de que llegue a abrir la ventana principal.
  app.on('window-all-closed', () => {
    stopServer();
    stopQueueWorker();
    stopBackupScheduler();
    if (process.platform !== 'darwin') app.quit();
  });

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
  startQueueWorker();
  startBackupScheduler();
  checkForAppUpdates();
}

app.whenReady().then(boot);

app.on('before-quit', () => {
  stopServer();
  stopQueueWorker();
  stopBackupScheduler();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
