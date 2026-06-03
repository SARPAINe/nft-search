# syntax=docker/dockerfile:1.7
#
# Multi-stage: build the SPA with Vite, then serve the static bundle
# (plus an API reverse-proxy) with nginx.

FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
# In the docker stack the API is reached via same-origin /api/* proxied
# by nginx, so leave VITE_API_URL unset and let the client fall back to
# window.location.origin at runtime.
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
