# Polling Strategies

> Two patterns for checking new data — short polling (repeated request-response with fixed intervals) and long polling (holding the connection open until data arrives or a timeout expires).

---

## What is it?

Polling is a communication pattern where a consumer repeatedly asks a producer for new data. There are two variants:

- **Short polling** — the consumer sends a request at a fixed interval. If no data is available, the producer responds immediately with an empty result. The consumer waits for the full interval before asking again.
- **Long polling** — the consumer sends a request and the producer holds the connection open until data arrives or a timeout expires. If data arrives, the producer responds immediately. If the timeout expires, the producer responds with an empty result and the consumer reconnects.

---

## Problem

Services need to consume data produced by other services or message queues, but a push-based connection (WebSocket, webhook) is not always available or appropriate:

- **Message queues** (SQS, RabbitMQ) require consumers to poll for messages.
- **Outbox tables** require a poller to read unprocessed events.
- **Client applications** need real-time updates but cannot use WebSockets (firewall restrictions, simple HTTP-only clients).

Without polling, consumers would never see new data. The question is: how frequently should they check, and at what cost?

---

## Example

### Short Polling — SQS

The consumer sends a request, SQS responds immediately — with or without messages:

```typescript
import { SQSClient, ReceiveMessageCommand } from '@aws-sdk/client-sqs';

const client = new SQSClient({ region: 'us-east-1' });

async function pollShort() {
  while (true) {
    const result = await client.send(new ReceiveMessageCommand({
      QueueUrl: process.env.QUEUE_URL!,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 0,          // short poll — respond immediately
    }));

    if (result.Messages) {
      for (const msg of result.Messages) {
        await process(msg);
        await client.send(new DeleteMessageCommand({
          QueueUrl: process.env.QUEUE_URL!,
          ReceiptHandle: msg.ReceiptHandle,
        }));
      }
    }

    // Even if queue was empty, loop immediately spins again
    await sleep(200); // manual throttle to avoid busy-waiting
  }
}
```

### Long Polling — SQS

The consumer sends a request, SQS holds the connection for up to 20 seconds:

```typescript
import { SQSClient, ReceiveMessageCommand } from '@aws-sdk/client-sqs';

const client = new SQSClient({ region: 'us-east-1' });

async function pollLong() {
  while (true) {
    const result = await client.send(new ReceiveMessageCommand({
      QueueUrl: process.env.QUEUE_URL!,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,         // long poll — wait up to 20s
    }));

    if (result.Messages) {
      for (const msg of result.Messages) {
        await process(msg);
        await client.send(new DeleteMessageCommand({
          QueueUrl: process.env.QUEUE_URL!,
          ReceiptHandle: msg.ReceiptHandle,
        }));
      }
    }
    // If empty after 20s, loop fires again — no manual throttle needed
  }
}
```

### HTTP Long Polling — Express

The server holds the response until an event occurs or a timeout expires:

```typescript
import express from 'express';
import { EventEmitter } from 'events';

const app = express();
const notifier = new EventEmitter();

// Producer — emits events
app.post('/events', (req, res) => {
  notifier.emit('update', req.body);
  res.status(204).end();
});

// Consumer — long polls for events
app.get('/poll', async (req, res) => {
  const timeout = setTimeout(() => {
    res.json({ data: null, timeout: true });
  }, 30_000); // hold connection for 30s max

  notifier.once('update', (data) => {
    clearTimeout(timeout);
    res.json({ data, timeout: false });
  });

  req.on('close', () => {
    clearTimeout(timeout);
  });
});
```

---

## Architecture / Flow

### Short Polling

```
Consumer                          Producer
   │                                  │
   │  "Any data?"                     │
   │ ──────────────────────────────►  │
   │  "No data" (empty response)      │
   │ ◄──────────────────────────────  │
   │         ◄── wait interval ──►    │
   │  "Any data?"                     │
   │ ──────────────────────────────►  │
   │  "Here is the data"              │
   │ ◄──────────────────────────────  │
```

### Long Polling

```
Consumer                          Producer
   │                                  │
   │  "Any data?"                     │
   │ ──────────────────────────────►  │
   │         (connection held open)   │
   │         ◄── data arrives ──►     │
   │  "Here is the data"              │
   │ ◄──────────────────────────────  │
   │                                  │
   │  "Any data?"                     │
   │ ──────────────────────────────►  │
   │         (connection held open)   │
   │         ◄── timeout ──►          │
   │  "No data"                       │
   │ ◄──────────────────────────────  │
```

---

## How it Works

1. The consumer sends a request to the producer or message queue asking for data.
2. **Short polling**: the producer responds immediately — with data if available, or empty if not.
3. **Long polling**: the producer defers the response — it holds the connection open, waiting for data or a timeout.
4. If data arrives before the timeout, the producer responds immediately with the data.
5. If the timeout expires, the producer responds with an empty result and the consumer reconnects.
6. The consumer processes the data (if any) and immediately issues the next poll request.
7. The cycle repeats indefinitely.

---

## Short vs Long Polling

| Aspect | Short Polling | Long Polling |
|--------|---------------|--------------|
| **Latency** | Up to the full poll interval | Near-real-time (data arrives within timeout) |
| **Request rate** | High (repeated regardless of data) | Low (one request per data batch or timeout) |
| **Cost** | More requests, more server load | Fewer requests, longer-held connections |
| **Connection overhead** | Low (quick request-response) | Higher (connections held open) |
| **Complexity** | Simple | Moderate (timeout management, reconnection) |
| **Load on producer** | Higher (handle many empty responses) | Lower (respond only when data exists) |
| **SQS default** | `WaitTimeSeconds=0` | `WaitTimeSeconds=20` |

### Short Polling vs Long Polling vs WebSocket vs SSE vs Webhook

| Pattern | Direction | Connection | Latency | Use Case |
|---------|-----------|------------|---------|----------|
| **Short polling** | Client pulls | Request-response, closed each time | Up to interval | Simple clients, firewalled environments |
| **Long polling** | Client pulls | Request-response, held open | Near-real-time | SQS, HTTP clients needing push-like behaviour |
| **WebSocket** | Bidirectional | Persistent, full-duplex | Real-time | Chat, live dashboards, gaming |
| **SSE** | Server pushes | Persistent, one-direction | Real-time | Live feeds, notifications (HTTP-only) |
| **Webhook** | Server pushes | None (server calls another server) | Near-real-time | Event notifications between services |

---

## Advantages

- **Short polling**: simple to implement, stateless, works over standard HTTP, no persistent connections required
- **Long polling**: lower latency than short polling, fewer requests, works through firewalls that block WebSocket, SQS native support
- Both are well-understood patterns with robust library support

---

## Trade-offs

- **Short polling**: high request volume when the queue is empty, wasted server resources handling empty responses, latency proportional to poll interval
- **Long polling**: server must manage concurrent held connections (connection limit), timeout tuning is critical, reconnection logic required on network errors
- Both are pull-based — the consumer must initiate every interaction, unlike push-based alternatives

---

## When to Use

- **SQS consumers** — always use long polling (`WaitTimeSeconds=20`) to reduce empty responses and cost
- **Outbox pollers** — short polling with exponential backoff (empty → sleep longer) to balance latency and database load
- **Client-side real-time updates** — long polling when WebSocket/SSE are unavailable due to firewall or infrastructure constraints
- **Third-party API polling** — short polling when the API has rate limits and no webhook support

---

## When NOT to Use

- **Real-time collaboration** — use WebSocket for bidirectional, low-latency communication
- **High-throughput event distribution** — use a message broker with push (Kafka consumer group, RabbitMQ push consumer) instead of polling
- **Server-to-server events** — use webhooks to avoid the polling overhead entirely
- **Browser applications** — prefer SSE for one-way server-to-client streaming (simpler than long polling)

---

## Related Concepts

- [Message Queues](message-queues.md) — SQS long polling, RabbitMQ consumer polling, consumer groups
- [Outbox Pattern](outbox-pattern.md) — outbox poller uses short polling with backoff to read unprocessed events
- [Claim-Check Pattern](claim-check-pattern.md) — polling for claimable work items; trade-off with PostgreSQL `LISTEN`/`NOTIFY`
- [Backpressure](backpressure.md) — polling rate interacts with backpressure; a fast poller can overwhelm a slow consumer
- [Delivery Semantics](delivery-semantics.md) — polling interacts with at-least-once delivery (long poll timeout may cause message visibility timeout)

---

## Key Takeaways

> Long polling is almost always better than short polling for message queue consumers — it reduces cost, latency, and server load. Use short polling for outbox pollers with exponential backoff (empty responses mean the poller should wait longer). For client-facing real-time updates, prefer WebSocket or SSE over polling; use long polling only when those are unavailable. SQS long polling with `WaitTimeSeconds=20` is the default recommendation for all SQS consumers.
