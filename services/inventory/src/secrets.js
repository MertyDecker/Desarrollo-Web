'use strict';

const fs = require('node:fs');

/**
 * Lee un secreto desde un archivo (Docker secrets lo monta en /run/secrets/...).
 * La variable de entorno contiene solo la RUTA del archivo, nunca el valor.
 */
function leerSecreto(variableConRuta) {
  const ruta = process.env[variableConRuta];
  if (!ruta) throw new Error(`Falta la variable ${variableConRuta} (ruta del archivo del secreto).`);
  const valor = fs.readFileSync(ruta, 'utf8').trim();
  if (!valor) throw new Error(`El secreto de ${variableConRuta} está vacío.`);
  return valor;
}

module.exports = { leerSecreto };
