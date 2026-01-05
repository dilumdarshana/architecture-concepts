import { randomUUID } from 'crypto';

export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE';

export class Task {
  private constructor(
    public readonly id: string,
    public title: string,
    public status: TaskStatus,
    public assigneeId?: string
  ) { }

  static create(title: string): Task {
    if (!title || title.trim().length < 3) {
      throw new Error('Task title must be at least 3 characters');
    }

    return new Task(
      randomUUID(),
      title.trim(),
      'OPEN'
    );
  }
}
