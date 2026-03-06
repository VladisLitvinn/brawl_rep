# Один образ: Node + статика, без сборки (без Vite)
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8888

COPY package.json .
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js index.html brawlers.json ./
COPY sounds/ ./sounds/
COPY english/ ./english/
COPY english_exercise/Learn_words_by_chunks/server/ ./english_exercise/Learn_words_by_chunks/server/

EXPOSE 8888
CMD ["node", "server.js"]
