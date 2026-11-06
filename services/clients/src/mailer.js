'use strict';

/**
 * Envío del código de verificación de correo.
 *
 * Adaptador "dev": entorno de prueba sin proveedor real de correo. Escribe el
 * mensaje en el log del contenedor marcado como [CORREO-SIMULADO] para poder
 * completar el flujo en local. Mantiene el mismo contrato que tendría un
 * proveedor real (destinatario + código) y NUNCA se usa en producción.
 */
function crearMailer({ adaptador = 'dev', logger = console } = {}) {
  if (adaptador === 'dev') {
    return {
      async enviarCodigo(correo, codigo) {
        logger.info(`[CORREO-SIMULADO] Para ${correo}: tu código de verificación de Fukusuke es ${codigo}`);
      }
    };
  }
  throw new Error(`Adaptador de correo no soportado: ${adaptador}`);
}

module.exports = { crearMailer };
