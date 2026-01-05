import express from 'express';
import { Pool } from 'pg';
import { PgTaskWriteRepository } from './infrastructure/repositories/task-write.repo.pg';
import { PgTaskReadRepository } from './infrastructure/repositories/task-read.repo.pg';
import { CreateTaskHandler } from './commands/create-task/create-task.handler';
import { GetTaskHandler } from './queries/get-task/get-task.handler';
import { taskCommandController } from './api/task.command.controller';
import { taskQueryController } from './api/task.query.controller';
import { EventBus } from './events/event-bus';
import { TaskCreatedProjection } from './projections/task-created.projection';
import { TaskCreatedEvent } from './events/task-created.event';
import { TaskStatusUpdatedEvent } from './events/task-status-updated.event';
import { TaskStatusUpdatedProjection } from './projections/task-status-updated.projection';
import { UpdateTaskStatusHandler } from './commands/update-task-status/update-task-status.handler';

export function createApp() {
  const app = express();

  // Built-in middleware for parsing JSON data
  app.use(express.json());

  // Built-in middleware for parsing URL-encoded form data
  app.use(express.urlencoded({ extended: true }));

  // Event Bus
  const eventBus = new EventBus();

  // Write DB
  const writePool = new Pool({
    connectionString: process.env.WRITE_DB_URL
  });

  // Read DB
  const readPool = new Pool({
    connectionString: process.env.READ_DB_URL
  });

  // Repositories
  const taskWriteRepo = new PgTaskWriteRepository(writePool);
  const taskReadRepo = new PgTaskReadRepository(readPool);

  // Handlers
  const createTaskHandler = new CreateTaskHandler(
    taskWriteRepo,
    eventBus,
  );
  const getTaskHandler = new GetTaskHandler(taskReadRepo);
  const updateTaskStatusHandler =
    new UpdateTaskStatusHandler(taskWriteRepo, eventBus);

  // Projection
  const taskCreatedProjection = new TaskCreatedProjection(taskReadRepo);
  const taskStatusUpdatedProjection =
    new TaskStatusUpdatedProjection(taskReadRepo);

  // Subscribe
  eventBus.subscribe<TaskCreatedEvent>(
    'TaskCreatedEvent',
    (event) => taskCreatedProjection.handle(event)
  );
  eventBus.subscribe<TaskStatusUpdatedEvent>(
    'TaskStatusUpdatedEvent',
    (event) => taskStatusUpdatedProjection.handle(event)
  );

  // Controllers
  app.use('/api/commands', taskCommandController(
    createTaskHandler,
    updateTaskStatusHandler,
  ));
  app.use('/api/queries', taskQueryController(getTaskHandler));

  return app;
}
