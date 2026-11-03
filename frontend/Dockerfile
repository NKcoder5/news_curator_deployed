# syntax=docker/dockerfile:1
#
# Pure Press web app: build the static site, then serve it with nginx. Build from
# this folder:
#   docker build -t pure-press-frontend .
#
# Create React App bakes REACT_APP_* values into the JavaScript at build time, so
# the API address is a build argument, not a run-time setting. Leave it empty for
# the usual cases (see .env.example for why).

FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY public ./public
COPY src ./src

ARG REACT_APP_API_URL=""
ENV REACT_APP_API_URL=$REACT_APP_API_URL
# CI=true makes the build fail on lint warnings, as it does on the CI runner.
ENV CI=true
RUN npm run build

# The unprivileged nginx image runs as a non-root user and listens on 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
