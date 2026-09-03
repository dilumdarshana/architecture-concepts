FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate
RUN pnpm install --frozen-lockfile

COPY prisma ./prisma/
RUN pnpm prisma generate

COPY src ./src/
RUN pnpm build

EXPOSE 3000

CMD ["node", "dist/index.js"]
