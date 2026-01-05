import express from 'express';
import { Pool } from 'pg';
import { PgTaskWriteRepository } from './infrastructure/repositories/task-write.repo.pg';
import { CreateTaskHandler } from './commands/create-task/create-task.handler';
import { createTaskController } from './api/task.controller';

export function createApp() {
  const app = express();

  // Built-in middleware for parsing JSON data
  app.use(express.json());

  // Built-in middleware for parsing URL-encoded form data
  app.use(express.urlencoded({ extended: true }));

  const pool = new Pool({
    connectionString: process.env.WRITE_DB_URL
  });

  const taskWriteRepo = new PgTaskWriteRepository(pool);
  const createTaskHandler = new CreateTaskHandler(taskWriteRepo);

  app.use(
    '/api',
    createTaskController(createTaskHandler)
  );

  return app;
}
