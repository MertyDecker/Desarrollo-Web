const mongoose = require('mongoose');

const productoSchema = new mongoose.Schema({
    nombre: { type: String, required: true },
    costo: { type: Number, required: true },
    disponibilidad: { type: Boolean, required: true }
});

module.exports = mongoose.model('Producto', productoSchema);