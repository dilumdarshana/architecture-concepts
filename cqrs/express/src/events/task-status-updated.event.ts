import { TaskStatus } from '../domain/task.status';

export class TaskStatusUpdatedEvent {
  constructor(
    public readonly taskId: string,
    public readonly status: TaskStatus,
    public readonly updatedAt: Date
  ) { }
}
