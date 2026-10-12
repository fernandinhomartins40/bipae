# Build from the repository root: docker build -f apps/web/Dockerfile .
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
ARG VITE_API_URL=http://localhost:3333
ENV VITE_API_URL=$VITE_API_URL
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @bipae/web build

FROM nginx:1.27-alpine
ARG VITE_API_URL=http://localhost:3333
# Used by the nginx template to allow API calls in the Content-Security-Policy.
ENV API_ORIGIN=$VITE_API_URL
COPY apps/web/docker/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
