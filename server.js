const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { ApolloServer, gql } = require('apollo-server-express');
const Producto = require('./models/producto');

// Conectar a tu MongoDB local
mongoose.connect('mongodb://localhost:27017/fukusuke_db');

// Definir qué se puede preguntar y hacer
const typeDefs = gql`
    type Producto {
        id: ID!
        nombre: String!
        costo: Int!
        disponibilidad: Boolean!
    }

    input ProductoInput {
        nombre: String!
        costo: Int!
        disponibilidad: Boolean!
    }

    type Query {
        getProductos: [Producto]
    }

    type Mutation {
        addProducto(input: ProductoInput!): Producto
    }
`;

// Darle funcionalidad a las preguntas y acciones
const resolvers = {
    Query: {
        getProductos: async () => await Producto.find()
    },
    Mutation: {
        addProducto: async (obj, { input }) => {
            const nuevo = new Producto(input);
            await nuevo.save();
            return nuevo;
        }
    }
};

// Encender el servidor
async function startServer() {
    const apolloServer = new ApolloServer({ typeDefs, resolvers });
    await apolloServer.start();
    const app = express();
    app.use(cors());
    apolloServer.applyMiddleware({ app, cors: false });

    app.listen(8090, () => console.log('¡Servidor Fukusuke abierto en http://localhost:8090/graphql !'));
}
startServer();