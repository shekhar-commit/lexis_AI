# syntax=docker/dockerfile:1

# Build the client bundle and compile the TypeScript Express server.
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build \
  && ./node_modules/.bin/esbuild server.ts --platform=node --format=esm --packages=external --outfile=server.js

# Keep the runtime image limited to production dependencies and built assets.
FROM node:22-alpine AS production
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js ./server.js

EXPOSE 3000
USER node

CMD ["node", "server.js"]
