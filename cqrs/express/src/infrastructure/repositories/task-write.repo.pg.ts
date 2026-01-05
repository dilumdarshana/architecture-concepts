import { Pool } from 'pg';
import { Task } from '../../domain/task.entity';
import { TaskWriteRepository } from './task-write.repo';

export class PgTaskWriteRepository implements TaskWriteRepository {
  constructor(private readonly pool: Pool) { }

  async save(task: Task): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO tasks (id, title, status, assignee_id)
      VALUES ($1, $2, $3, $4)
      `,
      [task.id, task.title, task.status, task.assigneeId ?? null]
    );
  }

  async updateStatus(taskId: string, status: string): Promise<Task | null> {
    const result = await this.pool.query(
      `
      UPDATE tasks
      SET status = $1
      WHERE id = $2
      RETURNING *
      `,
      [status, taskId]
    );

    return result.rows[0] ?? null;
  }
}
