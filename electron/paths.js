const path = require('path');
const { app } = require('electron');

// Empaquetado: electron-builder copia extraResources a <install-dir>/resources/.
// Dev (npm start): resources/ vive al lado de electron/, poblada por
// `npm run build-resources` (ver scripts/build-resources.js).
function resourcesRoot() {
  return app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, '..', 'resources');
}

const backendPath = () => path.join(resourcesRoot(), 'backend');
const phpBinary = () => path.join(resourcesRoot(), 'php', 'php.exe');

// %APPDATA%\<productName> — separado de donde vive el código (que se
// reinstala en cada actualización). Acá persiste la base real del comercio.
const dataDir = () => app.getPath('userData');

module.exports = { backendPath, phpBinary, dataDir };
