# license-tool

Herramientas para dar de alta la activación de cada instalación (ver
`electron/license.js` para cómo se valida del lado de la app). Nada de acá
se empaqueta ni se sube al instalador — es solo para correr a mano en tu PC.

## Primera vez

```
node generar-claves.js
```

Genera `clave-privada.pem` (queda solo acá, nunca se sube a git ni se
empaqueta — si se pierde, no podés generar más códigos de activación para
nadie) y actualiza la clave pública embebida en `electron/license.js`.

## Dar de alta un cliente

El cliente te manda el "código de dispositivo" que le muestra la app al
abrirla sin activar. Con eso:

```
# Prueba por tiempo limitado (se corta sola al vencer, aunque atrase el reloj)
node generar-activacion.js <CODIGO-DEL-CLIENTE> 14 "Nombre del cliente"

# Licencia definitiva, sin vencimiento
node generar-activacion.js <CODIGO-DEL-CLIENTE> "" "Nombre del cliente"
```

Te imprime el código de activación para pasarle al cliente, y además queda
guardado en `activaciones.json` (local, no se sube a git).

## Ver quién tiene qué, y quién está por vencer

```
node listar-activaciones.js
```

Lista todo lo generado hasta ahora, ordenado por fecha de vencimiento —
las licencias sin vencimiento quedan al final.

## Límite conocido

No hay forma de cortarle el acceso a alguien ANTES de la fecha que ya
quedó firmada en su código — la app es 100% offline y no depende de ningún
servidor para validar la licencia. Para eso haría falta que la app chequee
contra internet de forma obligatoria, lo cual iría en contra de que
funcione sin conexión.
