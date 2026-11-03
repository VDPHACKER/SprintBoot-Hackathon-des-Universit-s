FROM node:24.22.2-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
# Volume du journal d'audit: le dossier appartient à l'utilisateur non privilégié, le volume nommé en hérite à la création.
RUN mkdir /audit && chown node:node /audit
USER node
EXPOSE 3000
CMD ["node", "src/main.ts"]