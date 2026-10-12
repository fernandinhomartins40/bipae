# Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @bipae/api build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/apps/api
USER node
EXPOSE 3333
CMD ["node", "dist/main.js"]
