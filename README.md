# Architecture Concepts

> A playground for exploring architecture patterns, design principles, and best practices.  
> Focused on building **small, production-grade examples** to learn patterns like CQRS, Event Sourcing, Saga, Messaging, and more.

---

## Included
- CQRS
- gRPC
- OpenTelemetry
- Outbox + Idempotency + Retry

## Purpose

This repository is designed to:

- Serve as a **learning lab** for backend architecture patterns.
- Provide **self-contained, runnable examples** for each pattern.
- Document **real-world trade-offs, challenges, and solutions**.
- Act as a reference for **future projects, interviews, and blog content**.

> **Key philosophy:** Each pattern is isolated, documented, and executable. This is not just theory — everything here is meant to be **hands-on**.

---

## How to Use This Repository

1. **Explore the documentation first**  
   Check the [documentation index](docs/README.md) to understand the concepts behind each pattern.

2. **Run examples**  
   Each pattern has its own folder under `examples/`.  
   Example: `examples/cqrs/express-basic` contains a **simple CQRS implementation using Express and MongoDB**.

3. **Learn step by step**  
   - Start with **Express examples** to understand the core pattern without abstractions.  
   - Move to **framework-specific examples** (NestJS, Kafka, etc.) once the fundamentals are clear.

4. **Experiment freely**  
   Modify code, add new features, and test different ideas.  
   Each example is self-contained, so nothing will break across examples.

---

## Patterns & Concepts

Current patterns in the repository:

| Pattern | Example Folders | Status |
|---------|----------------|--------|
| CQRS (Command Query Responsibility Segregation) | [`cqrs/`](cqrs/) | In Progress |
| gRPC | [`grpc/`](grpc/) | Done |
| Event Emitter + Express | [`event-emitter/`](event-emitter/) | Done |
| OpenTelemetry | [`opentelemetry/`](opentelemetry/) | Done |
| Outbox + Idempotency + Retry | [`outbox-idempotency-retry/`](outbox-idempotency-retry/) | Done |
| Architecture Concepts (full index) | [`docs/README.md`](docs/README.md) | 69 docs |

> More patterns will be added over time, following the same **isolated, hands-on approach**.

---

## Key Principles

1. **Separation of concerns** – Commands vs Queries, Domain vs Infrastructure.
2. **Small, focused examples** – No giant monolithic apps.
3. **Self-contained** – Each example can run independently.
4. **Documentation first** – Every example has a README explaining the **why, how, and trade-offs**.
5. **Experimentation encouraged** – Change things, break things, learn things.

---
