'use strict';

const mongoose = require('mongoose');

// Base de datos propia de orders. Ningún otro servicio la lee ni la escribe.
const itemSchema = new mongoose.Schema(
  {
    productoId: String,
    nombre: String, // copia del nombre y precio al momento de comprar (historial)
    precioUnitario: Number,
    cantidad: Number,
    subtotal: Number
  },
  { _id: false }
);

const pedidoSchema = new mongoose.Schema(
  {
    _id: { type: String }, // UUID generado por el servicio
    clienteId: { type: String, required: true, index: true },
    items: { type: [itemSchema], required: true },
    direccion: { id: String, direccion: String, comuna: String, region: String },
    subtotal: { type: Number, required: true, min: 0 },
    envio: { type: Number, required: true, min: 0 },
    empaque: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 1 },
    estado: {
      type: String,
      required: true,
      enum: ['pendiente_pago', 'pagado', 'en_preparacion', 'en_despacho', 'entregado', 'cancelado']
    },
    historial: [{ _id: false, estado: String, fecha: String, por: String }],
    pagoId: { type: String, default: null },
    idempotencyKey: { type: String, required: true },
    huella: { type: String, required: true },
    creadoEn: { type: String, required: true }
  },
  { versionKey: false }
);
// La misma clave de idempotencia de un mismo cliente solo puede crear un pedido.
pedidoSchema.index({ clienteId: 1, idempotencyKey: 1 }, { unique: true });

const Pedido = mongoose.models.Pedido || mongoose.model('Pedido', pedidoSchema);

function normalizar(doc) {
  if (!doc) return null;
  const { _id, ...resto } = doc;
  return { id: _id, ...resto };
}

const repoMongo = {
  async crear(pedido) {
    const { id, ...resto } = pedido;
    try {
      await Pedido.create({ _id: id, ...resto });
      return { duplicado: false };
    } catch (err) {
      if (err && err.code === 11000) {
        return { duplicado: true, pedido: await this.buscarPorClave(pedido.clienteId, pedido.idempotencyKey) };
      }
      throw err;
    }
  },
  async buscarPorId(id) {
    return normalizar(await Pedido.findById(id).lean());
  },
  async buscarPorClave(clienteId, idempotencyKey) {
    return normalizar(await Pedido.findOne({ clienteId, idempotencyKey }).lean());
  },
  async listar({ clienteId, estado }, { limit = 20, offset = 0 } = {}) {
    const filtro = {};
    if (clienteId) filtro.clienteId = clienteId;
    if (estado) filtro.estado = estado;
    const docs = await Pedido.find(filtro).sort({ creadoEn: -1 }).skip(offset).limit(limit).lean();
    return docs.map(normalizar);
  },
  // Cambio de estado condicionado al estado actual (evita carreras entre solicitudes).
  async actualizarEstado(id, desde, hacia, por, fecha) {
    return normalizar(
      await Pedido.findOneAndUpdate(
        { _id: id, estado: desde },
        { $set: { estado: hacia }, $push: { historial: { estado: hacia, fecha, por } } },
        { new: true }
      ).lean()
    );
  },
  async marcarPagado(id, pagoId, fecha) {
    return normalizar(
      await Pedido.findOneAndUpdate(
        { _id: id, estado: 'pendiente_pago' },
        { $set: { estado: 'pagado', pagoId }, $push: { historial: { estado: 'pagado', fecha, por: 'payments' } } },
        { new: true }
      ).lean()
    );
  }
};

module.exports = { repoMongo, Pedido };
