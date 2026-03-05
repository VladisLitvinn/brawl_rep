# Stage 1: build English Exercise (Learn words by chunks) client
FROM node:20-alpine AS english-client
WORKDIR /build
COPY english_exercise/Learn_words_by_chunks/client/package.json english_exercise/Learn_words_by_chunks/client/package-lock.json ./
RUN npm ci
COPY english_exercise/Learn_words_by_chunks/client/ ./
RUN npm run build

# Stage 2: main app (Brawl + English API + English static) — production
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8888

COPY package.json .
RUN npm install --omit=dev

COPY server.js index.html brawlers.json ./
COPY sounds/ ./sounds/
# Роутер и сервисы English Exercise (один сервер, роут /api/english)
COPY english_exercise/Learn_words_by_chunks/server/ ./english_exercise/Learn_words_by_chunks/server/
# Собранный клиент English — отдача по /english/
COPY --from=english-client /build/dist ./english_dist

EXPOSE 8888
CMD ["node", "server.js"]
