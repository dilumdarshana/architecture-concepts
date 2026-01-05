import { Task } from '../../domain/task.entity';

export interface TaskWriteRepository {
  save(task: Task): Promise<void>;
}
