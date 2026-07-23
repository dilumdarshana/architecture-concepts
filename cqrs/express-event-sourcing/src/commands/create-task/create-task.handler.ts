import { randomUUID } from 'crypto';
import { CreateTaskCommand } from './create-task.command';
import { EventStore } from '../../event-store/event-store';
import { EventBus } from '../../events/event-bus';
import { TaskAggregate } from '../../domain/task.aggregate';

// Command handler for creating a new task.
//
// Event-sourcing flow:
// 1. Aggregate creates and validates the domain event
// 2. Event store appends it (expectedVersion=0 since this is a new aggregate)
// 3. Event bus notifies projections to update the read model
export class CreateTaskHandler {
  constructor(
    private readonly eventStore: EventStore,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: CreateTaskCommand): Promise<string> {
    const id = randomUUID();
    const { event } = TaskAggregate.create(id, command.title);

    // expectedVersion=0 means "no events exist for this aggregate yet"
    await this.eventStore.append(id, [event], 0);
    await this.eventBus.publish('TaskCreatedEvent', event);

    return id;
  }
}
