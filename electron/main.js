const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const http = require('http');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const {
  ensureInitialized, startServer, stopServer, PORT,
  startQueueWorker, stopQueueWorker,
  startBackupScheduler, stopBackupScheduler, runBackupIfDue,
} = require('./backend');
const { getLanIp } = require('./lan-ip');
const { obtenerCodigoDispositivo, licenciaValida, activar, verificarRelojOnline } = require('./license');
const { enviarHeartbeat, startHeartbeatScheduler, stopHeartbeatScheduler } = require('./heartbeat');
const { dataDir } = require('./paths');
const gdrive = require('./gdrive');

// Mismo callback en boot() y en restaurar-backup() de más abajo — un
// diálogo, no dos copias del mismo texto desincronizándose con el tiempo.
function onServerCrash() {
  if (mainWindow) {
    dialog.showErrorBox('El servidor se detuvo', 'Se va a reiniciar automáticamente.');
  }
  // No espera al próximo heartbeat programado (hasta 15 min) — si hay
  // internet en este momento, el panel se entera de la caída ahora mismo,
  // no cuando ya no te acordás ni el cliente sabe si te avisó.
  enviarHeartbeat();
}

// Fija el nombre explícito ANTES de pedir el lock de instancia única de
// abajo — en ese orden, no al revés. requestSingleInstanceLock() toca
// app.getPath('userData') internamente para su propio archivo de lock, y
// Electron cachea esa ruta la primera vez que se calcula: pedir el lock
// antes de poner el nombre dejaba la carpeta de datos fija en el nombre
// genérico de package.json ("escritorio-launcher") para siempre, sin
// importar qué setName() se llamara después (bug real, encontrado en vivo
// probando Palomar: terminó usando AppData\Roaming\escritorio-launcher en
// vez de \Palomar). De esto depende dónde vive la base real del comercio.
// Sin tilde/espacios a propósito: es más seguro para pegar en rutas
// manuales (PowerShell, scripts de soporte) sin problemas de encoding.
//
// clientAppName viene inyectado por clients/<cliente>/config.json vía
// -c.extraMetadata en scripts/release.js — así cada cliente tiene su propia
// carpeta de datos (AppData\Roaming\<nombre>) y dos clientes instalados en
// la misma PC (ej. de prueba) nunca comparten ni pisan la base del otro.
// Sin ese dato (build manual, "npm start" en dev) cae en el nombre de
// siempre, para no romper la instalación real ya existente.
app.setName(require('../package.json').clientAppName || 'StockFerreteria');

let mainWindow = null;

// Escala general de la interfaz — antes vivía como `zoom: 1.5` en el CSS del
// front (index.css), pero esa propiedad no estándar rompe el cálculo de
// posición de TODO lo que Chromium posiciona con `position: fixed` medido
// por JS (Popover/Menu/Select de MUI, que arman su Paper así): el navegador
// aplica bien el escalado visual, pero `getBoundingClientRect()` del ancla y
// el `position:fixed` del Paper terminan en marcos de referencia distintos,
// así que el menú/popover se renderiza lejos de donde se lo abrió (visto
// primero en el sidebar con position:fixed+100vh, después en TODOS los
// selects y en el selector de color de Etiquetas). El zoom nativo de
// Chromium (el mismo mecanismo que Ctrl+/Ctrl- en cualquier navegador) sí
// mantiene consistentes getBoundingClientRect/eventos de mouse/position:fixed
// bajo escala, así que reemplaza por completo al zoom por CSS.
//
// OJO: a diferencia del `zoom` de CSS, el zoom nativo SÍ reduce el viewport
// efectivo que ven los media queries (@media / useMediaQuery de MUI) — es
// zoom de verdad, como Ctrl+ en cualquier navegador, así que a más zoom
// "entra" menos ancho en CSS px y la app puede caer sola por debajo de sus
// propios breakpoints de escritorio (sidebar colapsando a hamburguer como en
// mobile, etc.). Con 1.5x en una notebook común eso pasaba de verdad — se
// bajó a 1.05x para dejar margen de sobra por encima del breakpoint 'md'
// (900px) de MUI en la mayoría de las resoluciones de notebook.
//
// zoomLevel usa escala logarítmica (factor = 1.2^nivel) — no hay setter
// directo por "factor" que persista de forma confiable antes de la primera
// carga, así que se precalcula el nivel equivalente al factor de abajo.
const BASE_ZOOM_LEVEL = Math.log(1.05) / Math.log(1.2);

// Sin esto, abrir el ícono dos veces (muy común: tarda en abrir la primera
// vez y el usuario vuelve a tocar) levanta DOS procesos completos a la vez
// — ambos corren ensureInitialized() en paralelo contra la MISMA base
// recién creada y se pisan entre sí creando las tablas, uno de los dos
// falla a mitad de camino ("table migrations already exists") y deja el
// usuario admin sin crear (por eso el login fallaba después). Con el lock,
// la segunda instancia se cierra sola apenas arranca y ni llega a tocar
// nada — en vez de eso, le pide a la primera que traiga su ventana al
// frente, como si el segundo click solo hubiera sido eso.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

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
    title: app.getName(),
    autoHideMenuBar: true,
    // show:false + mostrar recién en 'ready-to-show': por default Electron
    // muestra la ventana ni bien se crea, en blanco, y pinta el contenido
    // real un instante después — ese hueco en blanco es previo a que cargue
    // cualquier HTML (el splash con el logo de index.html no alcanza a
    // cubrirlo, porque la ventana ya se mostró vacía antes de que ese HTML
    // llegue a pintarse). Con esto la ventana queda oculta hasta que el
    // primer frame ya está pintado, así se ve el logo desde el instante en
    // que aparece la ventana, nunca un blanco antes.
    show: false,
    backgroundColor: '#2B2118',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  // 1280x800 fijo se ve chico en un monitor moderno (sobre todo comparado
  // con probar el front en un navegador maximizado) — arranca maximizada
  // por default, igual se puede desmaximizar a mano si alguien lo prefiere.
  mainWindow.once('ready-to-show', () => { mainWindow.maximize(); mainWindow.show(); });

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

  // Ctrl+/Ctrl-/Ctrl+0 para zoom — Electron trae un menú default con estos
  // atajos, pero el acelerador "CmdOrCtrl+Plus" no siempre dispara: en un
  // teclado en español/latam, Ctrl y la tecla "+/=" sin Shift produce "=",
  // no "+", y el acelerador registrado espera el símbolo exacto. Manejarlo
  // acá directo (por código físico de tecla, no por el símbolo que produce)
  // funciona sin importar el layout. autoHideMenuBar arriba NO alcanza:
  // esconde la barra, pero el menú (y sus atajos default, que pueden pisar
  // a este handler) sigue existiendo — hay que sacarlo del todo.
  Menu.setApplicationMenu(null);
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control || input.meta) return;
    if (input.code === 'Equal' || input.code === 'NumpadAdd') {
      event.preventDefault();
      mainWindow.webContents.zoomLevel = Math.min(5, mainWindow.webContents.zoomLevel + 0.5);
    } else if (input.code === 'Minus' || input.code === 'NumpadSubtract') {
      event.preventDefault();
      mainWindow.webContents.zoomLevel = Math.max(-5, mainWindow.webContents.zoomLevel - 0.5);
    } else if (input.code === 'Digit0' || input.code === 'Numpad0') {
      event.preventDefault();
      mainWindow.webContents.zoomLevel = BASE_ZOOM_LEVEL;
    }
  });

  // Aplica la escala base 1.5x acá (no en 'ready-to-show' ni una sola vez):
  // 'dom-ready' dispara en CADA carga/recarga (incluyendo el reintento de
  // lazyWithRetry.js tras un chunk-load-failure), así que el zoom nunca
  // vuelve a 100% sin querer si el front recarga solo por otra razón.
  mainWindow.webContents.on('dom-ready', () => {
    mainWindow.webContents.zoomLevel = BASE_ZOOM_LEVEL;
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

// Impresoras virtuales que Windows trae instaladas de fábrica (Print to PDF,
// XPS, Fax, OneNote) — getPrintersAsync() las devuelve igual que una térmica
// real, así que en cualquier PC sin impresora física de verdad "hay
// impresoras" igual. Pedirles print({silent:true}) no funciona: esperan un
// diálogo de guardado que el modo silencioso nunca les da, y la promesa se
// queda colgada para siempre — ni imprime, ni cae al flujo de la ventana
// visible, ni tira error. El síntoma real (probado en vivo): tocás
// "Imprimir Ticket" y no pasa nada, ni ventana ni descarga ni error.
const IMPRESORAS_VIRTUALES = /pdf|xps|onenote|fax/i;

// Imprime el ticket directo a la impresora del sistema, sin mostrar el
// diálogo de impresión — solo si hay al menos una impresora FÍSICA instalada
// (se filtran las virtuales, ver arriba). Si no hay ninguna, devuelve
// printed:false y el front cae al flujo de siempre (ventana con el ticket,
// para que lo impriman a mano, lo guarden como PDF o solo lo vean).
async function imprimirTicketDirecto(html) {
  const printers = await mainWindow?.webContents.getPrintersAsync().catch(() => []) ?? [];
  const printersReales = printers.filter((p) => !IMPRESORAS_VIRTUALES.test(p.name));
  if (!printersReales.length) return { printed: false };

  const win = new BrowserWindow({ show: false });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    // Resguardo aparte del filtro de arriba: si por lo que sea el callback de
    // print() nunca llega (driver colgado, etc.), esto igual corta a los 8s
    // y cae al flujo de la ventana visible en vez de dejar al cajero
    // esperando sin saber si pasó algo.
    await Promise.race([
      new Promise((resolve, reject) => {
        win.webContents.print({ silent: true, printBackground: true }, (success, reason) => {
          success ? resolve() : reject(new Error(reason || 'No se pudo imprimir'));
        });
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Tiempo de espera agotado al imprimir')), 8000)),
    ]);
    return { printed: true };
  } catch (err) {
    return { printed: false, error: err.message };
  } finally {
    if (!win.isDestroyed()) win.close();
  }
}

ipcMain.handle('imprimir-ticket', (_event, html) => imprimirTicketDirecto(html));

// Cuando no hay impresora física, el front baja el ticket como PDF en vez de
// abrir una ventana y disparar el diálogo de impresión del navegador — ese
// diálogo depende de que Windows tenga una impresora virtual "Imprimir a
// PDF" instalada y funcionando, y de que el cajero sepa usarlo (mismo tipo
// de problema que imprimirTicketDirecto ya resuelve para la impresión
// directa). printToPDF corre sobre el mismo HTML autocontenido del ticket,
// sin re-armar el diseño en otro formato — el front lo baja como cualquier
// otro PDF del sistema (Blob + descarga), sin diálogos ni pasos manuales.
async function generarTicketPdf(html) {
  const win = new BrowserWindow({ show: false });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    // 80mm de ancho (mismo @page del HTML del ticket) x 400mm de alto — un
    // ticket real nunca llega a esa altura, pero un solo "página" generosa
    // evita que un ticket largo (muchos ítems) se corte a mitad de camino
    // en una segunda hoja, que no tiene sentido para un comprobante térmico.
    const buffer = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: { width: 80000, height: 400000 },
      margins: { marginType: 'none' },
    });
    return buffer.toString('base64');
  } finally {
    if (!win.isDestroyed()) win.close();
  }
}

ipcMain.handle('generar-ticket-pdf', (_event, html) => generarTicketPdf(html));

// Backup en la nube — 100% opcional, a pedido del propio dueño del comercio
// (ver Configuración en el front). Si nunca se conecta, gdrive.subirBackup()
// en backend.js no hace nada distinto a hoy: el backup local sigue solo.
ipcMain.handle('drive-conectado', () => gdrive.conectado());
ipcMain.handle('drive-email', () => gdrive.emailConectado());
ipcMain.handle('drive-conectar', async () => {
  try {
    await gdrive.conectar();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('drive-desconectar', () => { gdrive.desconectar(); return { ok: true }; });

// El front antes solo sabía de "último backup" por localStorage, que se
// pisaba nada más al tocar "Descargar backup" a mano — el backup diario
// automático (ver startBackupScheduler en backend.js) corría en silencio y
// la pantalla de Configuración nunca se enteraba. Esto lee la carpeta real
// de backups y devuelve la fecha del más reciente, se haya generado por el
// scheduler o a mano — mismo archivo, misma carpeta, no hay diferencia real
// entre ambos casos salvo quién lo disparó.
ipcMain.handle('ultimo-backup-info', () => {
  const backupsDir = path.join(dataDir(), 'storage', 'app', 'backups');
  try {
    const archivos = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.gz'));
    if (archivos.length === 0) return { fecha: null, enDrive: false };
    const masReciente = archivos
      .map((f) => fs.statSync(path.join(backupsDir, f)).mtimeMs)
      .reduce((a, b) => Math.max(a, b));
    return { fecha: new Date(masReciente).toISOString(), enDrive: gdrive.conectado() };
  } catch {
    return { fecha: null, enDrive: false };
  }
});

// Restaurar un backup .gz directo desde Configuración — antes era un
// procedimiento 100% manual (ver RESTAURAR-BACKUP.md: cerrar la app,
// descomprimir a mano, reemplazar el archivo, reabrir). Mismo resultado,
// pero sin depender de que alguien lo haga bien a mano en la PC del cliente.
ipcMain.handle('restaurar-backup', async () => {
  const dir = dataDir();
  const backupsDir = path.join(dir, 'storage', 'app', 'backups');

  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Elegí el backup a restaurar',
    defaultPath: fs.existsSync(backupsDir) ? backupsDir : undefined,
    filters: [{ name: 'Backup de Stock (.gz)', extensions: ['gz'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return { ok: false, cancelado: true };

  let descomprimido;
  try {
    descomprimido = zlib.gunzipSync(fs.readFileSync(filePaths[0]));
  } catch {
    return { ok: false, error: 'No se pudo descomprimir el archivo — ¿es un backup válido?' };
  }
  // El header de cualquier base SQLite empieza siempre con este string de 16
  // bytes — confirmarlo ANTES de tocar la base real evita pisarla con un
  // archivo cualquiera que el usuario haya elegido por error.
  if (descomprimido.subarray(0, 16).toString('utf8') !== 'SQLite format 3\0') {
    return { ok: false, error: 'El archivo elegido no es un backup de base de datos válido.' };
  }

  const dbPath = path.join(dir, 'database.sqlite');
  // Por si algo sale mal a mitad de camino, la base actual no se pisa
  // directo — queda un .bak al lado, nunca se pierde sin dejar rastro.
  const backupPrevio = path.join(dir, `database.sqlite.antes-de-restaurar-${Date.now()}.bak`);

  stopServer();
  stopQueueWorker();
  try {
    if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, backupPrevio);
    fs.writeFileSync(dbPath, descomprimido);
  } catch (err) {
    startServer({ onCrash: onServerCrash });
    startQueueWorker();
    return { ok: false, error: `No se pudo reemplazar la base: ${err.message}` };
  }

  startServer({ onCrash: onServerCrash });
  startQueueWorker();
  try {
    await waitForServer(`http://127.0.0.1:${PORT}/api/v1/health`);
  } catch {
    return { ok: false, error: 'La base se restauró, pero el servidor no volvió a arrancar. Reiniciá la app.' };
  }

  return { ok: true };
});

// Chequea una sola vez, al arrancar — nunca en medio de una sesión, para no
// interrumpir una venta. Se descarga sola en segundo plano si hay una
// versión nueva, pero NUNCA se instala sola (autoInstallOnAppQuit=false):
// que se instale "cuando cierres" sonaba bien pero en la práctica cierran
// el programa en cualquier momento del día, no solo al final — force la
// instalación justo cuando hay un cliente esperando. En vez de eso, se le
// pregunta con "Reiniciar ahora" / "Más tarde": si elige más tarde, se le
// vuelve a preguntar recién la próxima vez que ABRA el programa (no al
// cerrar), así el que decide el momento es el dueño del local, no el
// sistema — puede esperar a después de cerrar, sin nadie en el mostrador.
// El repo de GitHub es público, así que no hace falta ningún token para
// chequear ni descargar.
function checkForAppUpdates() {
  if (!app.isPackaged) return; // en dev no hay instalador ni feed de releases

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-downloaded', () => {
    // Además del diálogo nativo (que se ve una sola vez), le avisa al front
    // para que deje un punto/indicador permanente en el sidebar — así si
    // cierran el diálogo sin prestar atención, el aviso sigue visible en
    // vez de perderse.
    mainWindow?.webContents.send('app-update-listo');

    dialog.showMessageBox({
      type: 'info',
      title: 'Actualización lista',
      // app.getName() es el nombre real de ESTE cliente ("Palomar",
      // "StockFerreteria", etc. — ver app.setName() más arriba), no un
      // texto fijo — antes decía "Stock Ferretería" en todos los clientes.
      message: `Hay una versión nueva de ${app.getName()}.`,
      detail: 'Instalala en un momento sin clientes esperando — no tarda mucho, pero conviene no tener el mostrador ocupado mientras pasa. Si elegís "Más tarde", te lo vuelvo a preguntar la próxima vez que abras el programa.',
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
    ipcMain.handle('activar-licencia', (_event, datos) => {
      const ok = activar(datos?.codigo, datos?.nombreNegocio, datos?.emailContacto, datos?.telefonoContacto);
      if (ok) {
        activado = true;
        // No bloqueante: si hay internet en este momento, deja guardada la
        // hora real ya desde la activación — cubre un reloj atrasado a mano
        // desde ANTES de activar, cuando licenciaValida() todavía no tiene
        // ninguna marca propia con la cual comparar (ver license.js).
        verificarRelojOnline();
        actWin.close();
      }
      return ok;
    });

    const actWin = new BrowserWindow({
      width: 480, height: 690, resizable: false, autoHideMenuBar: true,
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
    stopHeartbeatScheduler();
    if (process.platform !== 'darwin') app.quit();
  });

  try {
    ensureInitialized();
  } catch (err) {
    dialog.showErrorBox('No se pudo inicializar el sistema', String(err.message || err));
    app.quit();
    return;
  }

  startServer({ onCrash: onServerCrash });

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
  // No bloqueante — si hay internet, mantiene al día la hora real conocida
  // por esta instalación (ver verificarRelojOnline en license.js). No hace
  // falta más que esto una vez por apertura: la marca ya queda guardada.
  verificarRelojOnline();
  // Le avisa a tu panel central que esta instalación sigue viva — ver
  // heartbeat.js. Mismo criterio: best-effort, nunca bloquea nada. Uno ahora
  // + reenvíos periódicos mientras la app siga abierta (si no, "última
  // conexión" quedaba pegada en el momento del arranque).
  enviarHeartbeat();
  startHeartbeatScheduler();
}

app.whenReady().then(boot);

// Backup local automático al cerrar la app — así queda un backup fresco del
// día de trabajo que recién termina, sin depender de que la PC esté prendida
// a una hora fija (el negocio puede cerrar a cualquier hora, y muchas veces
// la PC se apaga apenas se cierra el sistema). runBackupIfDue() ya se fija
// solo si hace falta (no hace un backup nuevo si ya hay uno de hoy) — ver
// electron/backend.js. event.preventDefault() + un segundo app.quit() es el
// patrón estándar de Electron para hacer algo async antes de cerrar de una.
let backupDeCierreHecho = false;
app.on('before-quit', (event) => {
  if (backupDeCierreHecho) { stopServer(); stopQueueWorker(); return; }
  event.preventDefault();
  stopBackupScheduler();

  let yaSeCerro = false;
  const cerrarDeUna = () => {
    if (yaSeCerro) return;
    yaSeCerro = true;
    backupDeCierreHecho = true;
    stopServer();
    stopQueueWorker();
    app.quit();
  };
  // Si el backup se cuelga (PHP no responde, etc.), no hay que dejar al
  // usuario esperando para siempre con la app "trabada" al querer cerrarla.
  setTimeout(cerrarDeUna, 15000);
  runBackupIfDue(cerrarDeUna);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
