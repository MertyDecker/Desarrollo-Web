'use strict';

const mongoose = require('mongoose');

// Base de datos propia de clients: datos personales y direcciones.
const direccionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    direccion: { type: String, required: true },
    comuna: { type: String, required: true },
    region: { type: String, required: true }
  },
  { _id: false }
);

const clienteSchema = new mongoose.Schema(
  {
    run: { type: String, required: true, unique: true },
    nombre: { type: String, required: true },
    correo: { type: String, required: true, unique: true, lowercase: true },
    telefono: { type: String, required: true },
    estado: { type: String, required: true, enum: ['pendiente_validacion', 'activo'] },
    direcciones: { type: [direccionSchema], default: [] },
    // Solo se guarda el hash del código, nunca el código.
    codigoVerificacion: {
      hash: String,
      expira: Number,
      intentos: Number
    }
  },
  { timestamps: true }
);

const Cliente = mongoose.models.Cliente || mongoose.model('Cliente', clienteSchema);

function normalizar(doc) {
  if (!doc) return null;
  const { _id, __v, ...resto } = doc;
  return { id: _id.toString(), ...resto };
}

const repoMongo = {
  async crear(datos) {
    try {
      const doc = await Cliente.create(datos);
      return normalizar(doc.toObject());
    } catch (err) {
      if (err && err.code === 11000) throw Object.assign(new Error('duplicado'), { code: 'DUPLICADO' });
      throw err;
    }
  },
  async eliminar(id) {
    await Cliente.deleteOne({ _id: id });
  },
  async buscarPorId(id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return normalizar(await Cliente.findById(id).lean());
  },
  async buscarPorCorreo(correo) {
    return normalizar(await Cliente.findOne({ correo }).lean());
  },
  async guardarCodigo(id, codigo) {
    await Cliente.updateOne({ _id: id }, { $set: { codigoVerificacion: codigo } });
  },
  async sumarIntentoCodigo(id) {
    await Cliente.updateOne({ _id: id }, { $inc: { 'codigoVerificacion.intentos': 1 } });
  },
  async activar(id) {
    await Cliente.updateOne({ _id: id }, { $set: { estado: 'activo' }, $unset: { codigoVerificacion: 1 } });
  },
  async actualizarPerfil(id, datos) {
    if (!mongoose.isValidObjectId(id)) return null;
    return normalizar(await Cliente.findByIdAndUpdate(id, { $set: datos }, { new: true }).lean());
  },
  async agregarDireccion(id, dir) {
    await Cliente.updateOne({ _id: id }, { $push: { direcciones: dir } });
  }
};

module.exports = { repoMongo, Cliente };
