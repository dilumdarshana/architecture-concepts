# Event Emitter + Express

Demonstrates Node.js's **EventEmitter** pattern within an Express HTTP service — decoupling business logic from side effects using custom events.

```
POST /orders  ──►  orderService.create()  ──►  emits "order:created"
                                                     │
                            ┌────────────────────────┼────────────────────────┐
                            ▼                        ▼                        ▼
                    emailService.ts           notificationService.ts    (future listeners)
                    logs "Email sent"         logs "Push sent"
```

## Concepts Demonstrated

- **Extending EventEmitter** with a typed event map for type safety
- **Multiple decoupled listeners** — `orderService` does not import `emailService` or `notificationService`
- **Error event** — central `error` listener prevents process crashes
- **Graceful shutdown** — removes all event listeners before exit
- **Express integration** — EventEmitter bridge the gap between HTTP handlers and async side effects

## How to Run

```bash
pnpm install
pnpm dev
```

Make a request:

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{"productId": "prod-123", "quantity": 2}'
```

Output:

```
Server listening on port 3000
Order created: ord-abc123
[emailService] Sending confirmation for order ord-abc123...
[notificationService] Sending push notification for order ord-abc123...
```

## Reference

For the full concept explanation, see [Node.js Event Emitter](../docs/nodejs-event-emitter.md).
