import { PgTaskWriteRepository } from '../../infrastructure/repositories/task-write.repo.pg';
import { EventBus } from '../../events/event-bus';
import { UpdateTaskStatusCommand } from './update-task-status.command';
import { TaskStatusUpdatedEvent } from '../../events/task-status-updated.event';

export class UpdateTaskStatusHandler {
  constructor(
    private readonly taskWriteRepo: PgTaskWriteRepository,
    private readonly eventBus: EventBus
  ) { }

  async execute(command: UpdateTaskStatusCommand) {
    const task = await this.taskWriteRepo.updateStatus(
      command.taskId,
      command.status
    );

    if (!task) {
      throw new Error('Task not found');
    }

    await this.eventBus.publish<TaskStatusUpdatedEvent>(
      'TaskStatusUpdatedEvent',
      new TaskStatusUpdatedEvent(
        task.id,
        task.status,
        new Date()
      )
    );

    return task;
  }
}
