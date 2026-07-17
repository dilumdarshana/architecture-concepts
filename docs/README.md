# Architecture Concepts

A collection of architectural patterns, technologies, and design concepts — each documented with a consistent structure for quick understanding and interview preparation.

---

## Index

| # | Concept | Description |
|---|---------|-------------|
| 1 | [Distributed Systems](distributed-systems.md) | Collection of independent services collaborating over a network to function as a single system. |
| 2 | [Outbox Pattern](outbox-pattern.md) | Ensures reliable event delivery by writing events to a DB table within the same transaction as business data. |

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
