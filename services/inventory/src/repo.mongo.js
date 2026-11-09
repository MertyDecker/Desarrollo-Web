'use strict';

const mongoose = require('mongoose');
const { CATEGORIAS } = require('./app');

// Modelo interno de inventory. Es el único servicio que lee y escribe esta
// colección: ningún otro microservicio accede a esta base de datos.
const productoSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true, trim: true, maxlength: 80 },
    descripcion: { type: String, default: '', maxlength: 300 },
    precio: { type: Number, required: true, min: 1 }, // CLP enteros
    stock: { type: Number, required: true, min: 0 },
    categoria: { type: String, required: true, enum: CATEGORIAS },
    imagen: { type: String, default: null },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true }
);

productoSchema.index({ nombre: 1 }, { unique: true });

const Producto = mongoose.models.Producto || mongoose.model('Producto', productoSchema);

// Reserva de stock asociada a un pedido. El índice único (producto, pedido)
// hace que reservar dos veces para el mismo pedido no descuente dos veces.
const reservaSchema = new mongoose.Schema(
  {
    productoId: { type: String, required: true },
    pedidoId: { type: String, required: true },
    cantidad: { type: Number, required: true, min: 1 },
    estado: { type: String, required: true, enum: ['activa', 'liberada'] }
  },
  { timestamps: true }
);
reservaSchema.index({ productoId: 1, pedidoId: 1 }, { unique: true });
const Reserva = mongoose.models.Reserva || mongoose.model('Reserva', reservaSchema);

// Convierte el documento de Mongo en un objeto plano con "id" (no "_id").
function normalizar(doc) {
  if (!doc) return null;
  return {
    id: doc._id.toString(),
    nombre: doc.nombre,
    descripcion: doc.descripcion,
    precio: doc.precio,
    stock: doc.stock,
    categoria: doc.categoria,
    imagen: doc.imagen ?? null,
    activo: doc.activo
  };
}

const repoMongo = {
  async list({ available, category } = {}) {
    // El catálogo solo lista productos activos.
    const filtro = { activo: true };
    if (category) filtro.categoria = category;
    if (available === true) filtro.stock = { $gt: 0 };
    if (available === false) filtro.stock = 0;
    const docs = await Producto.find(filtro).sort({ nombre: 1 }).lean();
    return docs.map(normalizar);
  },

  async get(id) {
    return normalizar(await Producto.findById(id).lean());
  },

  async create(datos) {
    const doc = await Producto.create(datos);
    return normalizar(doc.toObject());
  },

  async replace(id, datos) {
    const doc = await Producto.findOneAndUpdate(
      { _id: id },
      { $set: datos },
      { new: true, runValidators: true }
    ).lean();
    return normalizar(doc);
  },

  async deactivate(id) {
    const res = await Producto.updateOne({ _id: id }, { $set: { activo: false } });
    return res.matchedCount === 1;
  },

  async getMany(ids) {
    const docs = await Producto.find({ _id: { $in: ids } }).lean();
    return docs.map(normalizar);
  },

  async reservar(productoId, pedidoId, cantidad) {
    const previa = await Reserva.findOne({ productoId, pedidoId }).lean();
    if (previa && previa.estado === 'activa') return { ok: true, cantidad: previa.cantidad, repetida: true };
    if (previa) return { ok: false, motivo: 'liberada' };
    // Descuento atómico: solo si hay stock suficiente y el producto está activo.
    const res = await Producto.updateOne(
      { _id: productoId, activo: true, stock: { $gte: cantidad } },
      { $inc: { stock: -cantidad } }
    );
    if (res.matchedCount === 0) {
      const existe = await Producto.exists({ _id: productoId, activo: true });
      return { ok: false, motivo: existe ? 'sin_stock' : 'no_existe' };
    }
    try {
      await Reserva.create({ productoId, pedidoId, cantidad, estado: 'activa' });
    } catch (err) {
      // Otra solicitud creó la misma reserva al mismo tiempo: se devuelve el stock.
      await Producto.updateOne({ _id: productoId }, { $inc: { stock: cantidad } });
      if (err && err.code === 11000) return { ok: true, cantidad, repetida: true };
      throw err;
    }
    return { ok: true, cantidad };
  },

  async liberar(productoId, pedidoId) {
    const r = await Reserva.findOneAndUpdate(
      { productoId, pedidoId, estado: 'activa' },
      { $set: { estado: 'liberada' } }
    ).lean();
    if (r) await Producto.updateOne({ _id: productoId }, { $inc: { stock: r.cantidad } });
    return !!r;
  }
};

module.exports = { repoMongo, Producto, Reserva };
