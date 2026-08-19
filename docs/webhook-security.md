# Webhook Security

> Verifying that an incoming webhook really came from the expected provider and was not tampered with, using HMAC signatures and replay protection.

---

## What is it?

A **webhook** is an HTTP callback — a provider (Stripe, GitHub, Slack) sends a POST request to your endpoint when an event occurs. Because the endpoint is public, anyone can send a request that looks like a webhook. **Webhook security** is the set of techniques — primarily **HMAC signature verification** — that lets the receiver prove the request came from the genuine provider and was not modified or replayed.

---

## Problem

Webhooks are unauthenticated HTTP POSTs by default:

- An attacker can **forge** a webhook (e.g. fake a `payment.succeeded` event) to trigger business logic
- A request can be **tampered with** in transit — the payload is modified after signing
- A captured request can be **replayed** — the same event delivered twice, causing duplicate side effects
- The provider's endpoint URL is public, so there is no shared secret in the request itself

Without verification, webhook handlers are a classic attack surface: they run business logic (update orders, send emails, trigger refunds) on data that may be fabricated.

---

## Example

### Verifying an HMAC-SHA256 signature (Node.js)

```typescript
import crypto from 'crypto';
import express from 'express';

const app = express();
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET!; // shared with the provider

// Must read the raw body — the signature covers the exact bytes sent
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['stripe-signature'] as string;
  const payload = req.body as Buffer;

  // 1. Extract timestamp and signature from the header
  const [t, sig] = signature.split(',').map((part) => part.split('=')[1]);

  // 2. Recompute the HMAC over timestamp + payload using the shared secret
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(`${t}.${payload.toString()}`)
    .digest('hex');

  // 3. Constant-time comparison — never use `===` (timing attacks)
  const valid = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));

  // 4. Replay protection — reject events older than a few minutes
  const age = Date.now() / 1000 - Number(t);
  if (!valid || age > 300) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // 5. Process the verified event
  const event = JSON.parse(payload.toString());
  handleEvent(event);
  res.json({ received: true });
});
```

---

## Architecture / Flow

```text
Provider (Stripe, GitHub, Slack)
  │ 1. Event occurs
  │ 2. Sign payload: HMAC-SHA256(secret, timestamp + body)
  │ 3. POST /webhooks/...  +  header: X-Signature: t=...,v1=...
  ▼
Your endpoint
  │ 4. Read raw body
  │ 5. Recompute HMAC with the shared secret
  │ 6. timingSafeEqual compare
  │ 7. Check timestamp age (replay protection)
  │ 8. Process event ──► idempotent handler
```

---

## How it Works

1. **The provider and receiver share a secret** — configured out-of-band (dashboard, env var, secret manager).
2. **The provider signs the payload** — computes an HMAC over the timestamp + raw body using the shared secret and sends it in a signature header.
3. **The receiver recomputes the HMAC** — using the same secret and the exact raw bytes received.
4. **The receiver compares signatures** — with a constant-time comparison to avoid timing attacks.
5. **The receiver checks the timestamp** — rejecting events older than a small window prevents replay.
6. **The handler processes the event idempotently** — so even a legitimate duplicate delivery causes no double side effects.

---

## Advantages

- **Authenticates the sender** — only the genuine provider (holding the shared secret) can produce a valid signature
- **Detects tampering** — any modification to the payload invalidates the HMAC
- **Prevents replay** — timestamp windows reject captured-and-replayed requests
- **Simple and standard** — HMAC-SHA256 is supported by every major webhook provider and language
- **No extra infrastructure** — verification is pure application code

---

## Trade-offs

| Concern | Risk | Mitigation |
|---------|------|------------|
| **Secret leakage** | If the shared secret leaks, signatures can be forged | Store in a [Secrets Management](secrets-management.md) system; rotate on suspicion |
| **Raw body handling** | Express JSON parsing alters the body, breaking the signature | Use `express.raw()` and parse after verification |
| **Clock skew** | Timestamp checks can reject legitimate events | Allow a small window (e.g. 5 minutes); use the provider's timestamp |
| **Key rotation** | Rotating the secret breaks in-flight verification | Support multiple keys (versioned secrets); verify against the current and previous key |
| **Duplicate delivery** | Providers retry on failure, causing duplicate events | Make handlers idempotent (see [Idempotency](idempotency.md)) |

---

## When to Use

- **Any third-party webhook** — Stripe, GitHub, Slack, Twilio, payment gateways
- **Event-driven integrations** — your service reacts to external events over HTTP
- **Public callback endpoints** — any URL a provider can POST to

---

## When NOT to Use

- **Internal service-to-service calls** — use [mTLS](tls-mtls.md) or [OAuth 2.0](oauth2.md) client credentials instead of webhook-style signatures
- **Polling instead of webhooks** — if the provider offers polling and you prefer it, no webhook security is needed
- **Trusted private networks** — if the endpoint is not publicly reachable, the threat model is different

---

## Related Concepts

- [Idempotency](idempotency.md) — webhook handlers must be idempotent to survive retries and duplicates
- [Secrets Management](secrets-management.md) — the shared webhook secret must be stored and rotated securely
- [TLS & mTLS](tls-mtls.md) — TLS protects the channel; HMAC verifies the sender
- [API Security (OWASP Top 10)](owasp-top-10.md) — webhook endpoints are part of the API attack surface
- [Retry Pattern](retry-pattern.md) — providers retry failed webhooks; handle with backoff and idempotency
- HMAC
- Signature Verification

---

## Key Takeaways

> Webhooks are unauthenticated HTTP callbacks — always verify them. Compute the HMAC-SHA256 over the timestamp + raw body with the shared secret, compare using `crypto.timingSafeEqual` (never `===`), and reject events older than a small window to prevent replay. Read the raw body before any JSON parsing, since the signature covers the exact bytes. Store the shared secret in a secret manager, support key rotation, and make webhook handlers idempotent so provider retries never cause double side effects.