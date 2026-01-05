import { CreateTaskCommand } from './create-task.command';
import { TaskWriteRepository } from '../../infrastructure/repositories/task-write.repo';
import { Task } from '../../domain/task.entity';
import { EventBus } from "../../events/event-bus";
import { TaskCreatedEvent } from "../../events/task-created.event";

export class CreateTaskHandler {
  constructor(
    private readonly taskWriteRepo: TaskWriteRepository,
    private readonly eventBus: EventBus,
  ) { }

  async execute(command: CreateTaskCommand): Promise<void> {
    const task = Task.create(command.title);

    await this.taskWriteRepo.save(task);

    await this.eventBus.publish(
      'TaskCreatedEvent',
      new TaskCreatedEvent(
        task.id,
        task.title,
        task.status,
        task.created_at
      )
    );

    // return task;
  }
}
