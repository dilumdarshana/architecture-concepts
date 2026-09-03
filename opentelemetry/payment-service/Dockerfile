FROM node:24-alpine

WORKDIR /app

# Copy workspace manifests and lockfile
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY order-service/package.json ./order-service/
COPY payment-service/package.json ./payment-service/

RUN corepack enable && corepack prepare pnpm@10.27.0 --activate
RUN pnpm install --frozen-lockfile --filter payment-service...

COPY payment-service/src ./payment-service/src/
COPY payment-service/tsconfig.json ./payment-service/tsconfig.json
RUN pnpm --filter payment-service build

EXPOSE 3001

CMD ["node", "payment-service/dist/index.js"]
