'use strict';

// Catálogo inicial (datos ficticios de prueba), tomado de los mockups del frontend.
// La carga es idempotente: si el producto ya existe NO se pisa su stock ni su precio.
const CATALOGO = [
  { nombre: 'Dragon Roll', descripcion: 'Unagi cremoso y pepino crocante cubierto con capas de palta y salsa tare dulce.', precio: 8990, stock: 30, categoria: 'rolls' },
  { nombre: 'Salmon Nigiri', descripcion: 'Salmón crudo premium cortado a mano, elegantemente dispuesto sobre arroz de sushi sazonado.', precio: 6490, stock: 40, categoria: 'nigiri' },
  { nombre: 'Spicy Tuna Roll', descripcion: 'Atún picante finamente picado, pepino y aderezo de mayo-chili de la casa.', precio: 7990, stock: 25, categoria: 'rolls' },
  { nombre: 'Rainbow Roll', descripcion: 'Base california cubierta con láminas de salmón, atún, camarón y palta cremosa.', precio: 9490, stock: 20, categoria: 'rolls' },
  { nombre: 'California Roll', descripcion: 'Auténtica ensalada de cangrejo, pepino fresco y palta envuelta en alga tostada premium.', precio: 5990, stock: 50, categoria: 'rolls' },
  { nombre: 'Unagi Roll', descripcion: 'Anguila de agua dulce ahumada con glaseado de soya dulce, palta y sésamo tostado.', precio: 8490, stock: 22, categoria: 'rolls' }
];

async function sembrar(Producto) {
  let creados = 0;
  for (const item of CATALOGO) {
    const res = await Producto.updateOne(
      { nombre: item.nombre },
      { $setOnInsert: { ...item, activo: true } },
      { upsert: true }
    );
    if (res.upsertedCount === 1) creados += 1;
  }
  return creados;
}

module.exports = { sembrar, CATALOGO };

// Uso manual: `npm run seed`
if (require.main === module) {
  const mongoose = require('mongoose');
  const { Producto } = require('./repo.mongo');
  (async () => {
    await mongoose.connect(process.env.MONGO_URL);
    const creados = await sembrar(Producto);
    console.log(`Seed completo: ${creados} producto(s) nuevo(s).`);
    await mongoose.disconnect();
  })().catch((err) => {
    console.error('Error en seed:', err.message);
    process.exit(1);
  });
}
