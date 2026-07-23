import { Router } from 'express';
import { GetTaskHandler } from '../queries/get-task/get-task.handler';
import { GetTaskQuery } from '../queries/get-task/get-task.query';

// Query-side HTTP controller (the "Q" in CQRS).
// Routes read requests to the query handler.
// Mounted under /api/queries in app.ts — separate from command routes.
export function taskQueryController(getTaskHandler: GetTaskHandler) {
  const router = Router();

  router.get('/tasks/:id', async (req, res) => {
    const task = await getTaskHandler.execute(
      new GetTaskQuery(req.params.id as string),
    );

    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    res.json(task);
  });

  return router;
}
