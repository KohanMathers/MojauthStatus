FROM node:24-alpine

ENV NODE_ENV=production \
  NODE_NO_WARNINGS=1 \
  DATA_DIR=/data \
  PORT=8787

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:8787/api/status || exit 1

CMD ["node", "src/index.js"]
