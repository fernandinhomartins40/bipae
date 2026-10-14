# Build from the repository root: docker build -f apps/web/Dockerfile .
# One image serves www.bipae.com.br: the landing page at "/", the app at "/app/" and the
# API proxied at "/v1/" (same origin, no CORS).
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
# Empty = the API is on the same origin under /v1.
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL
COPY . .
# O último passo publica o PDV Embed em endereço fixo (P-06): /pdv/<versão>/ e /pdv/<maior>/.
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @bipae/site build \
  && BIPAE_BASE=/app/ pnpm --filter @bipae/web build \
  && node kits/pdv-embed/scripts/publish.mjs apps/site/dist/pdv

FROM nginx:1.27-alpine
ARG VITE_API_URL=
# Extra origin allowed in the Content-Security-Policy when the API is on another origin.
ENV API_ORIGIN=$VITE_API_URL
COPY apps/web/docker/nginx.conf /etc/nginx/templates/default.conf.template
COPY apps/web/docker/security-headers.conf /etc/nginx/templates/snippets/security-headers.conf.template
COPY --from=build /app/apps/site/dist /usr/share/nginx/html
COPY --from=build /app/apps/web/dist /usr/share/nginx/html/app
EXPOSE 80
