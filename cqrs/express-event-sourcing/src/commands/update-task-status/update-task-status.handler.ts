import { UpdateTaskStatusCommand } from './update-task-status.command';
import { EventStore } from '../../event-store/event-store';
import { EventBus } from '../../events/event-bus';
import { TaskAggregate, TaskState } from '../../domain/task.aggregate';

// Command handler for updating a task's status.
//
// Event-sourcing flow:
// 1. Load all historical events for the aggregate from the event store
// 2. Replay them through the aggregate to reconstruct current state
// 3. Validate and produce a new event from the aggregate
// 4. Append the new event (with optimistic concurrency check via expectedVersion)
// 5. Publish to the event bus for projections
export class UpdateTaskStatusHandler {
  constructor(
    private readonly eventStore: EventStore,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: UpdateTaskStatusCommand): Promise<TaskState> {
    const events = await this.eventStore.getEvents(command.taskId);
    if (events.length === 0) {
      throw new Error('Task not found');
    }

    const aggregate = new TaskAggregate();
    aggregate.replay(events);

    const event = aggregate.updateStatus(command.status);

    // expectedVersion = aggregate.stateVersion ensures no concurrent
    // modification happened between loading and saving
    await this.eventStore.append(command.taskId, [event], aggregate.stateVersion);
    await this.eventBus.publish('TaskStatusUpdatedEvent', event);

    return aggregate.getSnapshot()!;
  }
}
