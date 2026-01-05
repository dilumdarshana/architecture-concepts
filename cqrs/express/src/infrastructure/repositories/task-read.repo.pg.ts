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
}
