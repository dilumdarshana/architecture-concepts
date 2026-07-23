import express from 'express';
import { Pool } from 'pg';
import { PgEventStore } from './event-store/event-store.pg';
import { PgTaskReadRepository } from './infrastructure/repositories/task-read.repo.pg';
import { CreateTaskHandler } from './commands/create-task/create-task.handler';
import { UpdateTaskStatusHandler } from './commands/update-task-status/update-task-status.handler';
import { GetTaskHandler } from './queries/get-task/get-task.handler';
import { taskCommandController } from './api/task.command.controller';
import { taskQueryController } from './api/task.query.controller';
import { EventBus } from './events/event-bus';
import { TaskCreatedProjection } from './projections/task-created.projection';
import { TaskStatusUpdatedProjection } from './projections/task-status-updated.projection';
import { TaskCreatedEvent } from './events/task-created.event';
import { TaskStatusUpdatedEvent } from './events/task-status-updated.event';

// Application composition root — wires all dependencies together.
//
// CQRS + Event Sourcing architecture:
//   - Write path: Controllers → Command Handlers → Event Store → Event Bus
//   - Read path:  Controllers → Query Handlers → Read Repository → Read DB
//   - Bridge:     Event Bus → Projections → Read Repository → Read DB
export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // --- Infrastructure ---
  const eventBus = new EventBus();

  const eventStorePool = new Pool({
    connectionString: process.env.WRITE_DB_URL,
  });
  const readPool = new Pool({
    connectionString: process.env.READ_DB_URL,
  });

  const eventStore = new PgEventStore(eventStorePool);
  const taskReadRepo = new PgTaskReadRepository(readPool);

  // --- Command handlers (write side) ---
  const createTaskHandler = new CreateTaskHandler(eventStore, eventBus);
  const updateTaskStatusHandler = new UpdateTaskStatusHandler(eventStore, eventBus);

  // --- Query handlers (read side) ---
  const getTaskHandler = new GetTaskHandler(taskReadRepo);

  // --- Projections (keep read model in sync) ---
  const taskCreatedProjection = new TaskCreatedProjection(taskReadRepo);
  const taskStatusUpdatedProjection = new TaskStatusUpdatedProjection(taskReadRepo);

  eventBus.subscribe<TaskCreatedEvent>(
    'TaskCreatedEvent',
    (event) => taskCreatedProjection.handle(event),
  );
  eventBus.subscribe<TaskStatusUpdatedEvent>(
    'TaskStatusUpdatedEvent',
    (event) => taskStatusUpdatedProjection.handle(event),
  );

  // --- Routes ---
  app.use('/api/commands', taskCommandController(createTaskHandler, updateTaskStatusHandler));
  app.use('/api/queries', taskQueryController(getTaskHandler));

  return app;
}
