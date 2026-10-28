# Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY . .
# O bundle (dist/main.js) já leva os pacotes @bipae/*; a imagem final só precisa dele, das
# migrações e das dependências de produção (PIE ACH-26: a imagem levava o monorepo inteiro, com
# Vite, Playwright e ferramentas de teste, e passava de 900 MB).
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @bipae/api build \
  && pnpm --filter @bipae/api deploy --prod --legacy /out \
  && rm -rf /out/node_modules/@bipae /out/node_modules/.pnpm/@bipae+*

FROM node:24-alpine
ENV NODE_ENV=production
# Mesmo caminho de antes: o compose e os comandos de manutenção continuam iguais.
WORKDIR /app/apps/api
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
USER node
EXPOSE 3333
CMD ["node", "dist/main.js"]
