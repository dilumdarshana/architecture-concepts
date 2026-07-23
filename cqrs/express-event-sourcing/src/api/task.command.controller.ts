import { Router, Request, Response } from 'express';
import { CreateTaskHandler } from '../commands/create-task/create-task.handler';
import { CreateTaskCommand } from '../commands/create-task/create-task.command';
import { UpdateTaskStatusHandler } from '../commands/update-task-status/update-task-status.handler';
import { UpdateTaskStatusCommand } from '../commands/update-task-status/update-task-status.command';

// Command-side HTTP controller (the "C" in CQRS).
// Routes incoming commands to the appropriate handler.
// Mounted under /api/commands in app.ts.
export function taskCommandController(
  createTaskHandler: CreateTaskHandler,
  updateTaskStatusHandler: UpdateTaskStatusHandler,
) {
  const router = Router();

  router.post('/tasks', async (req: Request, res: Response) => {
    const { title } = req.body;
    const id = await createTaskHandler.execute(new CreateTaskCommand(title));
    return res.status(201).json({ id });
  });

  router.patch('/tasks/:id/status', async (req: Request, res: Response) => {
    const { status } = req.body;
    const task = await updateTaskStatusHandler.execute(
      new UpdateTaskStatusCommand(req.params.id as string, status),
    );
    return res.json(task);
  });

  return router;
}
