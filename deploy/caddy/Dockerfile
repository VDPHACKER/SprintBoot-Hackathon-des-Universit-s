# Construit le client web puis le sert avec Caddy (une seule image pour l'entrée publique).
FROM node:24.22.2-alpine AS build
WORKDIR /app
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM caddy:2.11.7-alpine
COPY --from=build /app/dist /srv/client