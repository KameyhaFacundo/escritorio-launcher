# Manual — Sistema de gestión (ferretería)

## Qué es

Un sistema de stock, ventas, compras y caja que corre en la PC del local
(mostrador). Las demás cajas se conectan por red local usando el navegador,
sin instalar nada — solo la PC principal necesita el instalador.

## Instalación

1. Copiá el instalador (`Stock Ferreteria Setup X.X.X.exe`) a la PC que va a
   ser el servidor — la que va a estar siempre prendida durante el horario
   de atención.
2. Ejecutalo. No pide contraseña de administrador ni permisos especiales.
3. Al terminar, se abre solo. La primera vez tarda unos segundos más de lo
   normal — está preparando el sistema.

## Primer ingreso

Usuario: **admin@admin.com**
Clave: **admin123**

**Cambiá esta clave apenas entres** — Configuración (ícono de engranaje) →
Mi perfil.

Desde ahí mismo podés crear un usuario por cada empleado (cajero, etc.), con
los permisos que corresponda a cada uno — no hace falta que todos usen la
cuenta de administrador.

## Conectar las demás cajas

Al abrir la aplicación aparece un cartel con una dirección parecida a esta:

```
http://192.168.1.XX:8000
```

En cada caja adicional, abrí un navegador (Chrome, Edge) y escribí esa
dirección. Se puede guardar como favorito para no tener que escribirla cada
vez. Todas las cajas tienen que estar conectadas a la misma red (WiFi o
cable) que la PC principal.

**Importante:** la PC principal tiene que estar prendida y con la
aplicación abierta para que las demás cajas funcionen — si se apaga o se
cierra la aplicación, las otras cajas se quedan sin conexión.

## Backups (copias de seguridad)

El sistema genera un backup automático de todos los datos (ventas, stock,
clientes, todo) una vez por día mientras la aplicación esté abierta — no
hay que hacer nada manualmente. Se guarda en la PC, comprimido, y se
conservan los últimos 14 días.

**Recomendación importante:** estos backups viven en la misma PC. Si esa PC
se rompe, se moja, o se la roban, se pierden los backups junto con todo lo
demás. Cada tanto (una vez por semana, por ejemplo), copiá la carpeta de
backups a un pendrive o a una carpeta de Google Drive / Dropbox. Se
encuentra en:

```
%APPDATA%\StockFerreteria\storage\app\backups
```

(Pegá esa ruta en el explorador de Windows, en la barra de direcciones.)

## Facturación electrónica (ARCA, ex AFIP)

Por defecto el sistema factura en **modo prueba** — genera comprobantes con
un número de CAE ficticio, válido para probar el sistema pero no para
facturarle de verdad a un cliente.

Para facturar en serio hace falta cargar el certificado y la clave privada
de ARCA de esa empresa, desde Configuración → Facturación. Esto requiere
haber tramitado antes el certificado en la web de ARCA (guía aparte,
pendiente).

## Actualizaciones

Por ahora las actualizaciones son manuales: cuando haya una versión nueva,
se instala igual que la primera vez, con un instalador nuevo. Los datos
(ventas, stock, clientes, backups) **no se pierden** al actualizar — quedan
guardados aparte, en una carpeta separada de donde se instala el programa.

## Si algo no funciona

- **La aplicación no abre / se cierra sola:** volvé a abrirla. Si sigue
  fallando, revisá el archivo de registro en:
  ```
  %APPDATA%\StockFerreteria\storage\logs\laravel.log
  ```
  (las líneas más recientes están al final del archivo)
- **Las otras cajas no pueden conectarse:** confirmá que la PC principal
  esté prendida, con la aplicación abierta, y conectada a la misma red.
  Revisá también que el firewall de Windows no esté bloqueando la
  aplicación (la primera vez que arranca, Windows puede preguntar si
  permitís el acceso a la red — hay que decir que sí).
- **Se cortó la luz/internet a mitad de una venta:** el sistema funciona
  sin internet para todo lo que no sea facturación electrónica (ventas,
  stock, caja siguen andando). Si se corta la luz de la PC principal
  mientras hay ventas sin guardar, esas ventas puntuales se pierden — el
  resto de los datos ya guardados no se ve afectado.
