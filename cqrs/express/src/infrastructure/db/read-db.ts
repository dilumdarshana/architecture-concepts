import { Pool } from 'pg';

export const readDb = new Pool({
  connectionString: process.env.READ_DB_URL,
  ssl: { rejectUnauthorized: false },
});
