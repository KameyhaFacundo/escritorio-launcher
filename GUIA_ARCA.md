# Guía — Pasar la facturación electrónica a modo producción (ARCA, ex AFIP)

Por defecto el sistema factura en **modo prueba** (CAE ficticio, no válido
legalmente). Para facturar de verdad hace falta un certificado digital
propio del CUIT del comercio, autorizado por ARCA para el servicio de
Factura Electrónica (WSFE). Esto se hace **una sola vez** por comercio.

## Qué vas a necesitar antes de empezar

- CUIT del comercio, con **Clave Fiscal nivel 3** (se saca sin costo en
  cualquier oficina de ARCA con DNI, o desde la app "Mi ARCA" si el nivel
  actual no alcanza).
- Un punto de venta habilitado para Factura Electrónica en ARCA (si el
  comercio nunca facturó electrónicamente antes, puede que haya que
  habilitarlo — se hace desde el mismo sitio de ARCA, "Puntos de Venta y
  Domicilios").
- Una PC con OpenSSL instalado, para generar el certificado (los pasos de
  abajo asumen Windows con Git Bash, que ya trae OpenSSL — si no lo tenés,
  cualquier instalador de Git para Windows lo incluye).

## Paso 1 — Generar la clave privada y el pedido de certificado (CSR)

Esto se hace en cualquier PC, no hace falta que sea la del comercio. Corré
esto en una terminal (Git Bash):

```sh
openssl genrsa -out privada.key 2048
openssl req -new -key privada.key -subj "/CN=StockFerreteria/O=NOMBRE DEL COMERCIO/C=AR" -out solicitud.csr
```

Cambiá `NOMBRE DEL COMERCIO` por el nombre real.

**Si el segundo comando tira un error raro** (dice algo de una ruta de
`C:\Program Files\...` que no tiene nada que ver con `/CN=...`, o busca un
`openssl.cnf` que no existe): es Git Bash "traduciendo" el `/CN=...` como
si fuera una ruta de archivo de Windows. Se soluciona agregando esto antes
del comando, una sola vez por sesión de terminal:

```sh
export MSYS2_ARG_CONV_EXCL="*"
unset OPENSSL_CONF
```

Esto genera dos archivos:

- `privada.key` — la clave privada. **Guardala bien, no se comparte con
  nadie ni se sube a ARCA.** Es uno de los dos archivos que después se
  cargan en el sistema.
- `solicitud.csr` — el pedido de certificado. Este sí se sube a ARCA en el
  paso siguiente.

## Paso 2 — Pedir el certificado en ARCA

1. Entrá a **www.afip.gob.ar** (o el dominio que use ARCA al momento —
   viene del reemplazo de AFIP, el sitio puede haber cambiado de nombre)
   con la Clave Fiscal del comercio.
2. Buscá el servicio **"Administración de Certificados Digitales"**.
3. Subí el archivo `solicitud.csr` del paso anterior, ponele un alias
   (ej. "StockFerreteria-produccion").
4. ARCA te devuelve un certificado — descargalo (queda como un archivo
   `.crt` o `.pem`).

## Paso 3 — Autorizar el certificado para Factura Electrónica

1. Entrá al **"Administrador de Relaciones de Clave Fiscal"**.
2. Nueva relación → elegí el certificado que acabás de crear → asocialo al
   servicio **"wsfe" (Factura Electrónica)**.
3. Confirmá que el punto de venta que vas a usar esté habilitado para
   factura electrónica (si no, se habilita desde "Puntos de Venta y
   Domicilios", dentro del mismo sitio).

## Paso 4 — Cargar el certificado en el sistema

Con la aplicación abierta y logueado como admin:

1. Configuración (ícono de engranaje) → **Facturación**.
2. Certificado (.crt): el archivo que bajaste de ARCA en el Paso 2.
3. Clave (.key): el archivo `privada.key` que generaste en el Paso 1 (no
   el `.csr`).
4. Punto de venta: el número que habilitaste/confirmaste en el Paso 3.
5. Sacale el tilde a **"Homologación"** — eso es lo que hace que pase de
   modo prueba a modo real.
6. Guardar.

## Paso 5 — Confirmar que funciona

Emití una factura de prueba real (una venta chica) y fijate que el
comprobante tenga un CAE de verdad (no `99999999999999`, que es el que usa
el modo prueba) y que la fecha de vencimiento del CAE tenga sentido (~10
días desde la emisión).

## Problemas comunes

- **"El certificado o la clave no son válidos"** al guardar: seguramente
  subiste el `.csr` en vez del `.crt` que te dio ARCA, o la clave no
  corresponde al mismo par que generaste en el Paso 1.
- **Sigue emitiendo en modo prueba** después de cargar todo: revisá que
  el tilde de "Homologación" haya quedado destildado, y que el punto de
  venta cargado sea exactamente el mismo que autorizaste en ARCA.
- **Error de ARCA al emitir** (no de este sistema): usualmente es el punto
  de venta sin habilitar para facturación electrónica, o el certificado
  sin autorizar para el servicio "wsfe" — revisar los Pasos 2 y 3.
