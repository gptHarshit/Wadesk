FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Uses the lockfile when there is one (commit it after your first `npm install`).
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
  && npm cache clean --force

COPY migrations ./migrations
COPY src ./src

# Media files live here; mount a volume on it in production.
RUN mkdir -p /app/storage && chown -R node:node /app
USER node

EXPOSE 4000
# Applies any new migrations, then starts the API. The worker overrides this command.
CMD ["sh", "-c", "node src/migrate.js && node src/server.js"]
