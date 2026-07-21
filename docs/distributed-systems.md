# Distributed Systems

> A collection of independent computers (nodes/services) that work together and appear as a single system to users.

---

## What is it?

A **Distributed System** is a collection of independent computers (nodes/services) that work together and appear as a single system to users.

Each service runs independently, communicates over a network, and collaborates to complete business operations.

---

## Problem

As applications grow, running everything in a single application (monolith) becomes difficult due to:

- Scalability limitations
- Large codebases
- Single points of failure
- Independent deployment requirements
- Team ownership

Distributed systems allow different services to evolve and scale independently.

---

## Example

User places an order.

```text
Client
    │
    ▼
Order Service
    │
    ├── Save Order
    ├── Publish OrderCreated event
    ▼
Amazon SQS
    │
    ├── Inventory Service
    ├── Payment Service
    └── Notification Service
```

Each service processes the event independently.

With Node.js, the order service publishes to SQS:

```typescript
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { SQS } from 'aws-sdk';

const app = express();
const prisma = new PrismaClient();
const sqs = new SQS();

app.post('/orders', async (req, res) => {
  const { customerId, total } = req.body;

  const order = await prisma.order.create({
    data: { customerId, total, status: 'confirmed' }
  });

  await sqs
    .sendMessage({
      QueueUrl: process.env.ORDER_CREATED_QUEUE!,
      MessageBody: JSON.stringify({ orderId: order.id, total })
    })
    .promise();

  res.status(201).json(order);
});
```

And a downstream inventory service consumes the event:

```typescript
import { Consumer } from 'sqs-consumer';

const consumer = Consumer.create({
  queueUrl: process.env.ORDER_CREATED_QUEUE!,
  handleMessage: async (message) => {
    const { orderId } = JSON.parse(message.Body!);
    await reserveInventory(orderId);
  }
});

consumer.start();
```

---

## Architecture / Flow

```text
                 Client
                    │
                    ▼
             API Gateway / Load Balancer
                    │
      ┌─────────────┼─────────────┐
      ▼             ▼             ▼
 User Service   Order Service  Payment Service
      │             │             │
      └─────────────┼─────────────┘
                    ▼
              Message Queue
           (SQS / Kafka / RabbitMQ)
                    │
                    ▼
          Notification Service
```

Each service owns its own logic and often its own database.

---

## How it Works

1. Client sends a request.
2. Request reaches the appropriate service via an API gateway or load balancer.
3. Services communicate using:
   - HTTP/[gRPC](grpc.md) (synchronous)
   - Message queues/events (asynchronous)
4. Each service performs its own business logic.
5. Services may publish events for other services to consume.
6. Downstream services process events independently.
7. The final response is returned to the client.

---

## Advantages

- Independent deployment
- Independent scaling
- Better fault isolation
- Technology flexibility (each service can use different stacks)
- Smaller, maintainable codebases
- Clear team ownership per domain

---

## Trade-offs

- Increased operational complexity (deployment, monitoring, networking)
- Network latency between services
- Partial failures are hard to manage
- Distributed transactions are difficult
- Eventual consistency instead of strong consistency
- More monitoring and observability required

### Common Challenges

| Challenge | Description |
|-----------|-------------|
| Service discovery | Services need to find each other dynamically |
| Communication failures | Network calls can fail at any time |
| Data consistency | Keeping data in sync across services |
| Retry handling | Safe retry without causing duplicates |
| Idempotency | Same request processed once regardless of retries |
| Distributed tracing | Tracking a request across multiple services |
| Message ordering | Ensuring events are processed in sequence |
| Duplicate messages | Detecting and handling duplicates |

---

## When to Use

Use distributed systems when:

- Multiple teams own different domains
- High scalability is required
- High availability is important
- Services need independent deployments
- Event-driven architecture is desired

---

## When NOT to Use

Avoid distributed systems if:

- The application is small
- A monolith is sufficient
- Team size is small
- Operational complexity outweighs the benefits

Start with a monolith unless there is a clear need for distribution.

---

## Related Concepts

- Microservices
- Message Queues
- [Event-Driven Architecture](event-driven-architecture.md)
- [Outbox Pattern](outbox-pattern.md)
- Saga Pattern
- [CQRS](cqrs.md)
- [CAP Theorem](cap-theorem.md)
- Eventual Consistency
- [Distributed Lock](distributed-lock.md)
- Idempotency

### Common Patterns

- API Gateway
- Message Queue
- [Outbox Pattern](outbox-pattern.md)
- Saga Pattern
- [CQRS](cqrs.md)
- [Event Sourcing](event-sourcing.md)
- [Circuit Breaker](circuit-breaker.md)
- Retry Pattern
- [Distributed Lock](distributed-lock.md)

### Common Technologies

**Communication:** REST, gRPC, GraphQL

**Messaging:** Amazon SQS, Apache Kafka, RabbitMQ

**Caching:** Redis

**Service Discovery:** Kubernetes, Consul

**Monitoring:** Prometheus, Grafana, OpenTelemetry

---

## Key Takeaways

> A distributed system consists of multiple independent services that collaborate over a network to provide a single application. It improves scalability, availability, and independent deployments, but introduces challenges such as network failures, data consistency, and operational complexity. Common solutions include message queues, retries, idempotency, Outbox Pattern, and Saga Pattern.
