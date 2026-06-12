# PaperQueue — web edition. A single tiny Node service. One port, one image.
FROM node:20-alpine

WORKDIR /app

# Install only production deps first (better layer caching).
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# App source.
COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV PORT=5954
# Server-side persisted state (user settings) lives here. Mount a volume at it
# (see docker-compose) so settings survive container restarts and updates.
ENV DATA_DIR=/data
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 5954

# Simple healthcheck against the built-in endpoint.
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5954/api/health || exit 1

CMD ["node", "src/server.js"]
