FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Primero solo los manifiestos: aprovecha la caché de capas de Docker.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# El proceso no corre como root.
USER node

EXPOSE 3003

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3003) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
