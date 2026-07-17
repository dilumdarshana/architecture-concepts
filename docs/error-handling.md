# Error Handling (Express)

> Centralized error middleware for async route handlers that ensures every thrown or rejected error reaches a single handler, preventing unhandled rejections and hung requests.

---

## What is it?

In Express, errors from synchronous route handlers are caught automatically and forwarded to error middleware. Async route handlers that throw or reject are **not** — they result in unhandled promise rejections and clients hanging indefinitely. Centralized async error handling wraps every route so thrown errors are forwarded to a single `(err, req, res, next)` middleware.

---

## Problem

An async route handler that throws is never caught:

```typescript
app.get('/orders/:id', async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) throw new NotFoundError('Order not found');
  res.json(order);
});
```

This error is swallowed — Express does not catch promise rejections. The client hangs until timeout, and the process may log an `unhandledRejection`. This applies to any async route:

- Database query fails and throws -> client gets no response
- Validation error thrown -> client hangs
- Any rejected `await` -> client gets no response

Without centralized handling, every route must duplicate try/catch:

```typescript
app.get('/orders/:id', async (req, res, next) => {
  try {
    const order = await prisma.order.findUnique(...);
    if (!order) throw new NotFoundError('Order not found');
    res.json(order);
  } catch (err) {
    next(err);
  }
});
```

---

## Example

### Wrap Async Handlers Automatically

A utility wrapper that catches rejected promises and forwards them to `next`:

```typescript
import { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
```

Usage — no try/catch needed in individual routes:

```typescript
app.get(
  '/orders/:id',
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) throw new NotFoundError('Order not found');
    res.json(order);
  })
);
```

### Centralized Error Middleware

A single error middleware returns consistent error responses for every route:

```typescript
import { Request, Response, NextFunction } from 'express';

class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, message);
  }
}

class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super(400, message);
  }
}

// Centralized error middleware — registered last
function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.name,
      message: err.message
    });
    return;
  }

  // Unexpected errors — log and return generic 500
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'InternalServerError',
    message: 'An unexpected error occurred'
  });
}
```

### Express 5 — Built-in Async Error Handling

Express 5 natively catches rejected promises from async route handlers:

```typescript
// Express 5 — no wrapper needed
app.get('/orders/:id', async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) throw new NotFoundError('Order not found');
  res.json(order);
});
```

However, wrapping still provides cleaner error types and consistent response formatting.

### Global Unhandled Rejection Handler

For errors that slip through (e.g. background promise with no `next`):

```typescript
process.on('unhandledRejection', (reason: Error) => {
  console.error('Unhandled rejection:', reason);
  // Optionally log to external monitoring and exit for restart
  // process.exit(1);
});
```

---

## Architecture / Flow

```text
Request
  │
  ▼
Route Handler (async)
  │
  ├── Success ──► res.json()
  │
  └── Throw/reject
        │
        ▼
  asyncHandler wrapper
        │
        catch(fn) ──► next(err)
        │
        ▼
  Error Middleware
        │
        ├── AppError ──► res.status(code).json({ error, message })
        │
        └── Unknown ──► console.error + res.status(500)
```

---

## How it Works

1. Request arrives and matches a route handler.
2. The route handler is wrapped by `asyncHandler` (or Express 5 does this implicitly).
3. If the handler resolves successfully, the response is sent normally.
4. If the handler throws or returns a rejected promise, the wrapper catches it.
5. The wrapper calls `next(err)` with the error, skipping all remaining middleware and jumping to the error middleware.
6. Error middleware checks the error type:
   - Known `AppError` subclasses return structured error responses with the appropriate HTTP status.
   - Unknown errors log the full stack trace and return a generic 500 response.
7. If no error middleware is registered, Express returns a default HTML error page.

---

## Advantages

- **No duplicated try/catch** — each route handler focuses on business logic
- **Consistent responses** — every error uses the same shape, status codes, and naming
- **Guarded against unhandled rejections** — async errors never go unnoticed
- **Separation of concerns** — error formatting lives in one place, not scattered across routes
- **Express 5 ready** — the pattern works with both Express 4 (wrapper) and Express 5 (native)

---

## Trade-offs

| Trade-off | Impact |
|-----------|--------|
| **Wrapper needed for Express 4** — the `asyncHandler` utility must be applied to every route | Easy to forget on one route, leaving it unprotected |
| **Error type coupling** — relying on `instanceof AppError` assumes the error hierarchy is consistent | Third-party errors must be mapped or wrapped |
| **Global catch-all** — the error middleware is a single point where errors are consumed | If the error middleware itself throws, the process crashes |
| **Stack traces** — async stack traces can be long and noisy in production | Requires a logging tool that aggregates and trims traces |

---

## When to Use

- Every Express/Fastify application with async route handlers
- APIs that need consistent error response structures
- Projects migrating to Express 5 (backward-compatible pattern)
- Any team where duplicated try/catch blocks cause inconsistency

---

## When NOT to Use

- Synchronous-only servers where errors are already caught
- Applications that use a framework with built-in async error handling (Koa, Hapi, Fastify with `setErrorHandler`)
- Very small scripts where the overhead of a wrapper is unnecessary

---

## Related Concepts

- [Promise APIs](promise-apis.md) — `Promise.resolve().catch(next)` is the core mechanism behind `asyncHandler`
- [Graceful Shutdown](graceful-shutdown.md) — unhandled rejections during shutdown must be handled to avoid process exit
- Express Error Middleware
- Express 5
- HTTP Status Codes

---

## Key Takeaways

> Express does not catch promise rejections from async route handlers — every async route must be wrapped or the error is silently lost. Use an `asyncHandler` wrapper that forwards rejected promises to `next(err)`, then centralize all error responses in a single error middleware. This eliminates duplicated try/catch and ensures every error returns a consistent response with the correct status code.
