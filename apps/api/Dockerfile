# apps/api/Dockerfile
# 🚨 Cambiamos Alpine por Debian Slim (Bookworm)
FROM node:20-bookworm-slim

# 1. Instalar dependencias nativas (OpenSSL es VITAL para Prisma)
RUN apt-get update -y && apt-get install -y openssl python3 make g++

# 2. Instalar pnpm globalmente
RUN npm install -g pnpm

# 3. Directorio de trabajo
WORKDIR /app

# 4. Copiar código
COPY . .

# 5. Instalar dependencias
RUN pnpm install

# 6. Forzar versión de Prisma e inicializar
RUN npm install -g prisma@5
RUN npx prisma generate --schema=packages/database/prisma/schema.prisma

# 7. Compilar API
RUN pnpm --filter api build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# 8. Arrancar
CMD ["pnpm", "--filter", "api", "start:prod"]
