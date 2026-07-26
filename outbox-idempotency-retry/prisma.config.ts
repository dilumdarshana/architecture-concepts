import { defineConfig, env } from 'prisma/config'

// Prisma 7 uses a separate config file instead of embedding
// the datasource URL in schema.prisma. The URL is injected
// via .env or environment variables at runtime.
export default defineConfig({
  datasource: {
    url: env('DATABASE_URL'),
  },
})
