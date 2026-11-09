'use strict';

const mongoose = require('mongoose');

// Base de datos propia de payments: cobros y avisos del proveedor ya procesados.
const pagoSchema = new mongoose.Schema(
  {
    _id: String,
    pedidoId: { type: String, required: true, index: true },
    clienteId: { type: String, required: true },
    monto: { type: Number, required: true, min: 1 },
    medio: { type: String, required: true, enum: ['webpay', 'servipag', 'transferencia'] },
    estado: { type: String, required: true, enum: ['pendiente', 'aprobado', 'rechazado'] },
    urlPago: String,
    creadoEn: String
  },
  { versionKey: false }
);
// Un solo cobro pendiente por pedido (evita pagos duplicados).
pagoSchema.index({ pedidoId: 1 }, { unique: true, partialFilterExpression: { estado: 'pendiente' }, name: 'un_pendiente_por_pedido' });

const eventoSchema = new mongoose.Schema(
  { _id: String, pagoId: String, recibidoEn: { type: Date, default: Date.now } },
  { versionKey: false }
);

const Pago = mongoose.models.Pago || mongoose.model('Pago', pagoSchema);
const EventoPago = mongoose.models.EventoPago || mongoose.model('EventoPago', eventoSchema);

const norm = (d) => (d ? (({ _id, ...r }) => ({ id: _id, ...r }))(d) : null);

const repoMongo = {
  async crear(pago) {
    const { id, ...resto } = pago;
    try {
      await Pago.create({ _id: id, ...resto });
      return { duplicado: false };
    } catch (err) {
      if (err && err.code === 11000) return { duplicado: true, pago: await this.pendientePorPedido(pago.pedidoId) };
      throw err;
    }
  },
  async buscarPorId(id) {
    return norm(await Pago.findById(id).lean());
  },
  async pendientePorPedido(pedidoId) {
    return norm(await Pago.findOne({ pedidoId, estado: 'pendiente' }).lean());
  },
  async cambiarEstado(id, desde, hacia) {
    return norm(await Pago.findOneAndUpdate({ _id: id, estado: desde }, { $set: { estado: hacia } }, { new: true }).lean());
  },
  async eventoProcesado(eventoId) {
    return (await EventoPago.exists({ _id: eventoId })) !== null;
  },
  async registrarEvento(eventoId, pagoId) {
    await EventoPago.updateOne({ _id: eventoId }, { $setOnInsert: { pagoId } }, { upsert: true });
  }
};

module.exports = { repoMongo, Pago, EventoPago };
