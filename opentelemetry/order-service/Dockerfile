FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache openssl

# Copy workspace manifests and lockfile
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY order-service/package.json ./order-service/
COPY payment-service/package.json ./payment-service/

RUN corepack enable && corepack prepare pnpm@10.27.0 --activate
RUN pnpm install --frozen-lockfile --filter order-service...

# Prisma generate for order-service
COPY order-service/prisma ./order-service/prisma/
RUN cd order-service && pnpm exec prisma generate

COPY order-service/src ./order-service/src/
COPY order-service/tsconfig.json ./order-service/tsconfig.json
RUN pnpm --filter order-service build

EXPOSE 3000

CMD ["node", "order-service/dist/index.js"]
