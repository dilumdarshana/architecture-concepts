import { Pool } from 'pg';
import { DomainEvent } from '../events/domain-event';
import { EventStore } from './event-store';
import { TaskCreatedEvent } from '../events/task-created.event';
import { TaskStatusUpdatedEvent } from '../events/task-status-updated.event';
import { TaskStatus } from '../domain/task.status';

type EventRow = {
  aggregate_id: string;
  aggregate_type: string;
  event_type: string;
  event_data: Record<string, unknown>;
  version: number;
  created_at: Date;
};

// Strips metadata fields before storing the pure business payload as JSONB.
function serializeEvent(event: DomainEvent): { eventType: string; data: Record<string, unknown> } {
  const { eventType, aggregateId, version, ...payload } = event as any;
  return {
    eventType: event.eventType,
    data: payload,
  };
}

// Reconstructs typed event objects from stored rows.
// Date strings are parsed back into Date instances.
function deserializeEvent(row: EventRow): DomainEvent {
  const data = row.event_data;

  switch (row.event_type) {
    case 'TaskCreatedEvent':
      return new TaskCreatedEvent(
        row.aggregate_id,
        data.title as string,
        data.status as string,
        new Date(data.createdAt as string),
        row.version,
      );
    case 'TaskStatusUpdatedEvent':
      return new TaskStatusUpdatedEvent(
        row.aggregate_id,
        data.status as TaskStatus,
        new Date(data.updatedAt as string),
        row.version,
      );
    default:
      throw new Error(`Unknown event type: ${row.event_type}`);
  }
}

// PostgreSQL-backed event store with optimistic concurrency control.
//
// The (aggregate_id, version) UNIQUE constraint prevents two writers
// from appending at the same version. The check-then-insert inside
// a transaction provides an additional safety net with a clear error.
export class PgEventStore implements EventStore {
  constructor(private readonly pool: Pool) {}

  async append(
    aggregateId: string,
    events: DomainEvent[],
    expectedVersion: number,
  ): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Verify no concurrent writes happened between load and save.
      const check = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM event_store WHERE aggregate_id = $1`,
        [aggregateId],
      );

      if (check.rows[0].cnt !== expectedVersion) {
        throw new Error(
          `Concurrency conflict: aggregate ${aggregateId} has ${check.rows[0].cnt} events, expected ${expectedVersion}`,
        );
      }

      // Assign sequential version numbers starting from expectedVersion.
      let version = expectedVersion;
      for (const event of events) {
        version++;
        const { eventType, data } = serializeEvent(event);
        await client.query(
          `INSERT INTO event_store (aggregate_id, aggregate_type, event_type, event_data, version, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [aggregateId, 'Task', eventType, JSON.stringify(data), version, new Date()],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Loads all events for an aggregate in chronological order.
  // The handler replays these through the aggregate to reconstruct state.
  async getEvents(aggregateId: string): Promise<DomainEvent[]> {
    const result = await this.pool.query<EventRow>(
      `SELECT * FROM event_store WHERE aggregate_id = $1 ORDER BY version ASC`,
      [aggregateId],
    );

    return result.rows.map(deserializeEvent);
  }
}
