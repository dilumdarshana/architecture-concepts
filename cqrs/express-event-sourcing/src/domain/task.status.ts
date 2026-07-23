// Valid states for a Task aggregate in the event-sourced system.
// Transitions are enforced by the aggregate's business rules.
export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE';
