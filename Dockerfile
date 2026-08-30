# ---- build stage: compile the Svelte frontend ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage: node:sqlite is built in, so no npm deps needed ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY --from=build /app/dist ./dist
COPY server.js package.json ./
COPY scripts ./scripts
EXPOSE 8787
CMD ["node", "server.js"]
