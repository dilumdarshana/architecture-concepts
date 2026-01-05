import { Router, Request, Response } from 'express';
import { CreateTaskHandler } from '../commands/create-task/create-task.handler';
import { CreateTaskCommand } from '../commands/create-task/create-task.command';
import { UpdateTaskStatusHandler } from '../commands/update-task-status/update-task-status.handler';
import { UpdateTaskStatusCommand } from '../commands/update-task-status/update-task-status.command';

export function taskCommandController(
  createTaskHandler: CreateTaskHandler,
  updateTaskStatusHandler: UpdateTaskStatusHandler,
) {
  const router = Router();

  router.post('/tasks', async (req: Request, res: Response) => {
    const { title } = req.body;

    await createTaskHandler.execute(
      new CreateTaskCommand(title)
    );

    return res.status(201).send();
  });

  router.patch('/tasks/:id/status', async (req, res) => {
    const { status } = req.body;

    const task = await updateTaskStatusHandler.execute(
      new UpdateTaskStatusCommand(
        req.params.id,
        status,
      )
    );

    return res.status(204).send();
  });


  return router;
}
