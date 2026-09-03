FROM node:22-slim

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate
RUN pnpm install --frozen-lockfile

COPY src ./src/
RUN pnpm build

EXPOSE 3001

CMD ["node", "dist/index.js"]
