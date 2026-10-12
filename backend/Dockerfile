# syntax=docker/dockerfile:1
#
# Pure Press API. Build from this folder:
#   docker build -t pure-press-backend .
# Configuration is read from the environment at run time (see .env.example);
# nothing secret is baked into the image.
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first, so editing source does not reinstall them. bcrypt ships a
# prebuilt binary for musl, so no compiler is needed on Alpine.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# tesseract.js downloads a language file the first time a screenshot in that
# language is read and keeps it in the working directory. The server runs as an
# unprivileged user, so that directory has to belong to it or the first
# screenshot in a new language cannot be read.
RUN chown node:node /app
USER node

EXPOSE 5000

# /health answers without touching the database, so it says the process is up,
# not that Mongo is. Node's own fetch is used because Alpine has no curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 5000) + '/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "app.js"]
