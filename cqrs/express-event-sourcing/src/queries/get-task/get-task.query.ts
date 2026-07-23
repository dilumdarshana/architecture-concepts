// Queries do not modify state — they only read from the denormalized read DB.
// This is the Query side of CQRS: separate model, separate storage, separate handler.
export class GetTaskQuery {
  constructor(public readonly id: string) {}
}
