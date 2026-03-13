# apps/web/Dockerfile
# 🚨 Cambiamos Alpine por Debian Slim (Bookworm)
FROM node:20-bookworm-slim

# 1. Instalar OpenSSL para el motor de Prisma en el Frontend
RUN apt-get update -y && apt-get install -y openssl

# 2. Instalar pnpm
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

# 7. Compilar Next.js
RUN pnpm --filter web build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# 8. Arrancar
CMD ["pnpm", "--filter", "web", "start"]
