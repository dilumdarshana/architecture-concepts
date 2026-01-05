// Queries do not modify state

export class GetTaskQuery {
  constructor(public readonly id: string) { }
}
