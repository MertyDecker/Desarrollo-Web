'use strict';

const mongoose = require('mongoose');

// Base de datos propia de auth: solo credenciales y tokens revocados.
const credencialSchema = new mongoose.Schema(
  {
    clienteId: { type: String, required: true, unique: true },
    correo: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    rol: { type: String, required: true, enum: ['cliente', 'admin'] },
    estado: { type: String, required: true, enum: ['pendiente', 'activo'] },
    intentosFallidos: { type: Number, default: 0 },
    bloqueadoHasta: { type: Number, default: null }
  },
  { timestamps: true }
);

const revocadoSchema = new mongoose.Schema({
  jti: { type: String, required: true, unique: true },
  // Índice TTL: Mongo elimina el registro cuando el token ya habría vencido.
  expira: { type: Date, required: true, index: { expires: 0 } }
});

const Credencial = mongoose.models.Credencial || mongoose.model('Credencial', credencialSchema);
const TokenRevocado = mongoose.models.TokenRevocado || mongoose.model('TokenRevocado', revocadoSchema);

const repoMongo = {
  async crearCredencial(datos) {
    try {
      await Credencial.create(datos);
    } catch (err) {
      if (err && err.code === 11000) throw Object.assign(new Error('duplicado'), { code: 'DUPLICADO' });
      throw err;
    }
  },
  async buscarPorCorreo(correo) {
    return Credencial.findOne({ correo }).lean();
  },
  async activar(clienteId) {
    const res = await Credencial.updateOne({ clienteId }, { $set: { estado: 'activo' } });
    return res.matchedCount === 1;
  },
  async eliminarPendiente(clienteId) {
    await Credencial.deleteOne({ clienteId, estado: 'pendiente' });
  },
  async registrarFallo(clienteId, { maxIntentos, bloqueoHasta }) {
    const doc = await Credencial.findOneAndUpdate(
      { clienteId },
      { $inc: { intentosFallidos: 1 } },
      { new: true }
    ).lean();
    if (doc && doc.intentosFallidos >= maxIntentos) {
      await Credencial.updateOne({ clienteId }, { $set: { bloqueadoHasta: bloqueoHasta, intentosFallidos: 0 } });
    }
  },
  async reiniciarFallos(clienteId) {
    await Credencial.updateOne({ clienteId }, { $set: { intentosFallidos: 0, bloqueadoHasta: null } });
  },
  async revocar(jti, expira) {
    await TokenRevocado.updateOne({ jti }, { $setOnInsert: { jti, expira } }, { upsert: true });
  },
  async estaRevocado(jti) {
    return (await TokenRevocado.exists({ jti })) !== null;
  },
  async existeAdmin() {
    return (await Credencial.exists({ rol: 'admin' })) !== null;
  }
};

module.exports = { repoMongo, Credencial, TokenRevocado };
