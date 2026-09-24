FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# As migrações são lidas em tempo de execução por `npm run migrate`.
COPY db ./db
COPY package.json ./

USER node
EXPOSE 3000

# Sem HEALTHCHECK na imagem: ela serve os dois papéis, e o worker não sobe
# servidor HTTP — um check em /health marcaria todo worker como não saudável.
# Quem roda o papel "api" define o check (GET /health) no orquestrador.

# Migração no container: npm run migrate:prod (a imagem não tem tsx).
# api e worker escalam separados: sobrescreva o comando com "api" ou "worker".
CMD ["node", "dist/index.js", "all"]
