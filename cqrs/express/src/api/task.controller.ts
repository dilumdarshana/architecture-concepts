import { Router, Request, Response } from 'express';
import { CreateTaskHandler } from '../commands/create-task/create-task.handler';
import { CreateTaskCommand } from '../commands/create-task/create-task.command';

export function createTaskController(
  createTaskHandler: CreateTaskHandler
) {
  const router = Router();

  router.post('/tasks', async (req: Request, res: Response) => {
    const { title } = req.body;

    await createTaskHandler.execute(
      new CreateTaskCommand(title)
    );

    return res.status(201).send();
  });

  return router;
}
