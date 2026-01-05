export class TaskCreatedEvent {
  constructor(
    public readonly id: string,
    public readonly title: string,
    public readonly status: string,
    public readonly createdAt: Date
  ) { }
}
