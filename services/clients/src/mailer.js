'use strict';

/**
 * Envío del código de verificación de correo.
 *
 * Adaptador "dev": entorno de prueba sin proveedor real de correo. Escribe el
 * mensaje en el log del contenedor marcado como [CORREO-SIMULADO] para poder
 * completar el flujo en local. Mantiene el mismo contrato que tendría un
 * proveedor real (destinatario + código) y NUNCA se usa en producción.
 */
function crearMailer({ adaptador = 'dev', logger = console, bandeja = process.env.MAIL_OUTBOX_FILE } = {}) {
  if (adaptador === 'dev') {
    return {
      async enviarCodigo(correo, codigo) {
        logger.info(`[CORREO-SIMULADO] Para ${correo}: tu código de verificación de Fukusuke es ${codigo}`);
        // En modo local, además se deja el mensaje en una "bandeja" de archivo
        // (local-data/correos.log) para poder leerlo sin revisar la consola.
        if (bandeja) {
          require('node:fs').appendFileSync(bandeja, `${new Date().toISOString()} ${correo} ${codigo}\n`);
        }
      }
    };
  }
  throw new Error(`Adaptador de correo no soportado: ${adaptador}`);
}

module.exports = { crearMailer };
