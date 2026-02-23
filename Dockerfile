FROM node:20-alpine

WORKDIR /app

COPY package.json .
RUN npm install --production

COPY index.html brawlers.json server.js ./
COPY sounds/ ./sounds/

EXPOSE 8888

ENV PORT=8888
CMD ["node", "server.js"]
