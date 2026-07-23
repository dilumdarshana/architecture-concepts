import { Pool } from 'pg';

// The read model is a denormalized view — not the source of truth.
// It is populated and maintained by projections that consume domain events.
export interface TaskReadModel {
  id: string;
  title: string;
  status: string;
  created_at: Date;
}

// Read-side repository. Operates on task_view which is built from events.
// This repository is only used by query handlers and projections.
export class PgTaskReadRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<TaskReadModel | null> {
    const result = await this.pool.query(
      `SELECT * FROM task_view WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  // Called by TaskCreatedProjection when a new task is created.
  async insert(task: {
    id: string;
    title: string;
    status: string;
    created_at: Date;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO task_view (id, title, status, created_at) VALUES ($1, $2, $3, $4)`,
      [task.id, task.title, task.status, task.created_at],
    );
  }

  // Called by TaskStatusUpdatedProjection when status changes.
  async updateStatus(taskId: string, status: string): Promise<void> {
    await this.pool.query(
      `UPDATE task_view SET status = $1 WHERE id = $2`,
      [status, taskId],
    );
  }
}
