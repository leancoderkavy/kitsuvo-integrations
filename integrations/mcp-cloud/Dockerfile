FROM node:24.22.1-alpine
ENV NODE_ENV=production
RUN apk add --no-cache su-exec
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY icon-256.png remote.html remote.css remote-page.mjs server.mjs plus.mjs posthog.mjs operation-queue.mjs protocol-sessions.mjs durable-store.mjs server-card.json ./
COPY docker-entrypoint.sh ./
RUN chmod 755 docker-entrypoint.sh
ENTRYPOINT ["./docker-entrypoint.sh"]
EXPOSE 8080
CMD ["node", "server.mjs"]
