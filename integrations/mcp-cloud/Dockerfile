FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server.mjs operation-queue.mjs server-card.json ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
