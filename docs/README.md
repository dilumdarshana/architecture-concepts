# Architecture Concepts

A collection of architectural patterns, technologies, and design concepts — each documented with a consistent structure for quick understanding and interview preparation.

---

## Index

| # | Concept | Description |
|---|---------|-------------|
| 1 | [Distributed Systems](distributed-systems.md) | Collection of independent services collaborating over a network to function as a single system. |
| 2 | [Outbox Pattern](outbox-pattern.md) | Ensures reliable event delivery by writing events to a DB table within the same transaction as business data. |
| 3 | [Concurrency vs Parallelism](concurrency-vs-parallelism.md) | Distinguishes dealing with many tasks from executing them simultaneously in Node.js. |
| 4 | [Database Concurrency Control](database-concurrency-control.md) | Transactions, atomic operations, optimistic and pessimistic locking for safe concurrent data access. |
| 5 | [Idempotency](idempotency.md) | Safe retries via idempotency keys to prevent duplicate side effects. |
| 6 | [Promise APIs](promise-apis.md) | Coordinating multiple async operations with Promise.all, allSettled, race, and any. |
| 7 | [Distributed Transactions](distributed-transactions.md) | Two-Phase Commit and coordination strategies for atomicity across services. |
| 8 | [Saga Pattern](saga-pattern.md) | Sequence of local transactions with compensating actions for multi-service workflows. |
| 9 | [Practical Project](practical-project.md) | Reference e-commerce architecture applying all patterns in a real distributed system. |

---

## Template

New concepts should follow the structure defined in [`_template.md`](_template.md).

### Required Sections

| Section | Purpose |
|---------|---------|
| **What is it?** | Definition and core idea |
| **Problem** | What problem it solves |
| **Example** | Quick practical example |
| **Architecture / Flow** | Diagram or request flow |
| **How it Works** | Step-by-step lifecycle |
| **Advantages** | Benefits |
| **Trade-offs** | Downsides or costs |
| **When to Use** | Appropriate use cases |
| **When NOT to Use** | Alternatives |
| **Related Concepts** | Linked patterns/technologies |
| **Key Takeaways** | Summary for quick recall |

---

## Contributing

To add a new concept:

1. Copy `_template.md` to `<concept-name>.md`
2. Fill in each section
3. Add an entry to the index table above
