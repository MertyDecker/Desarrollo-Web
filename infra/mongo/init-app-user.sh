#!/bin/bash
# Se ejecuta UNA vez, cuando se crea el volumen de datos de cada MongoDB.
# Crea el usuario de la aplicación con permisos mínimos: solo lectura/escritura
# sobre la base de datos de SU servicio. El usuario root no lo usa ningún servicio.
set -e

mongosh --quiet \
  -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" \
  --authenticationDatabase admin \
  "$MONGO_INITDB_DATABASE" --eval "
    db.createUser({
      user: '$APP_DB_USER',
      pwd: '$APP_DB_PASSWORD',
      roles: [{ role: 'readWrite', db: '$MONGO_INITDB_DATABASE' }]
    });
  "
