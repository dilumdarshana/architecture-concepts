import { Pool } from 'pg';

export interface TaskReadModel {
  id: string;
  title: string;
  status: string;
  created_at: Date;
}

export class PgTaskReadRepository {
  constructor(private readonly pool: Pool) { }

  async findById(id: string): Promise<TaskReadModel | null> {
    const result = await this.pool.query(
      `SELECT * FROM task_view WHERE id = $1`,
      [id]
    );

    return result.rows[0] ?? null;
  }

  async insert(task: {
    id: string;
    title: string;
    status: string;
    created_at: Date;
  }) {
    await this.pool.query(
      `
    INSERT INTO task_view (id, title, status, created_at)
    VALUES ($1, $2, $3, $4)
    `,
      [task.id, task.title, task.status, task.created_at]
    );
  }
}
