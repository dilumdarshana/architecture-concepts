# Security Principles

> The foundational principles every security decision builds on — defence in depth, least privilege, blast-radius containment, attack-surface reduction, threat modeling, and zero trust.

---

## What is it?

Security is not a single feature or a checklist — it is a set of **principles** that guide how a system is designed, built, and operated. These principles are the *why* behind every concrete control in the Security section. Six principles cover most decisions:

| Principle | Core idea |
|-----------|-----------|
| **Defence in depth** | Layer independent controls so a breach in one layer does not expose the whole system |
| **Least privilege** | Grant the minimum access needed to do a job, and revoke it when done |
| **Blast-radius containment** | Limit the damage of a single failure, leak, or compromise to a small area |
| **Attack-surface reduction** | Minimise what is exposed to untrusted input or callers |
| **Threat modeling** | Identify what you are defending, who attacks it, and how — before writing code |
| **Zero trust** | Never trust a network, device, or caller by default; verify every request |

They overlap and reinforce each other: least privilege and segmentation both contain blast radius; threat modeling reveals the attack surface; defence in depth is how you apply the rest at every layer.

---

## Problem

Without explicit principles, security becomes reactive and inconsistent:

- A team secures the perimeter but has no internal controls — one phished credential gives full access (no defence in depth, no zero trust)
- A service account holds admin rights it rarely uses — a leak in that account compromises everything (no least privilege)
- A single shared database serves every tenant with no isolation — one SQL-injection bug leaks *all* customer data (no blast-radius containment)
- An endpoint is left public "just in case" and forgotten — it becomes an unmonitored entry point (no attack-surface reduction)
- Security is bolted on after launch — vulnerabilities are found by attackers, not by design (no threat modeling)

The principles exist to make security **systematic**: each decision can be judged against them rather than against a vague sense of "good practice".

---

## Example

### Illustrative — one request, layered defences

```text
POST /orders/:id/charge

  Layer 1  Rate limit (abuse/DoS)              → 429 if the client is flooding
  Layer 2  Authenticate (who are you?)         → 401 if the token is missing/invalid
  Layer 3  Authorise (least privilege)         → 403 if the scope/role is insufficient
  Layer 4  Validate input (shape, type, size)  → 400 if the payload is malformed
  Layer 5  Own the resource (blast radius)     → 404 if the order belongs to someone else
  Layer 6  Parameterised query (injection)     → the DB can never interpret data as code
```

If any single layer fails, the others still hold. That is defence in depth.

### Node.js / TypeScript — layered middleware

```typescript
import express from 'express';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const app = express();

// Layer 1: rate limit (abuse)
app.post('/orders/:id/charge', rateLimit({ windowMs: 60_000, max: 50 }));

// Layer 2: authenticate — verify identity (see api-authentication.md)
app.post('/orders/:id/charge', authenticate);

// Layer 3: least privilege — the token must carry the write scope (see oauth2.md)
app.post('/orders/:id/charge', requireScope('orders:write'));

// Layer 4: validate input at the boundary
app.post('/orders/:id/charge', validate(chargeSchema));

// Layer 5+6: blast-radius containment (ownership) + injection defence (parameterised query)
app.post('/orders/:id/charge', async (req, res) => {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, userId: req.user.sub }, // scope to the caller (IDOR)
  });
  if (!order) return res.status(404).json({ error: 'Not found' }); // 404, don't leak existence
  // ... charge the order
});
```

Each middleware enforces a different principle. Remove any one and a specific class of attack is back — but the others remain, so the damage is bounded.

---

## Architecture / Flow

Defence in depth is often drawn as concentric layers: an attacker must breach every ring to reach the data, and each ring independently blocks a class of threat.

```text
          ┌──────────────────────────────────────┐
          │  Network edge  (CDN, WAF, firewall)  │  ← attack-surface reduction, DDoS
          │  ┌────────────────────────────────┐  │
          │  │  Transport  (TLS / mTLS)       │  │  ← confidentiality + identity
          │  │  ┌──────────────────────────┐  │  │
          │  │  │  Identity  (authN/authZ) │  │  │  ← least privilege, zero trust
          │  │  │  ┌────────────────────┐  │  │  │
          │  │  │  │  Application      │  │  │  │  ← validation, ownership (blast radius)
          │  │  │  │  ┌──────────────┐ │  │  │  │
          │  │  │  │  │  Data (RLS)  │ │  │  │  │  ← final backstop, row-level isolation
          │  │  │  │  └──────────────┘ │  │  │  │
          │  │  │  └────────────────────┘  │  │  │
          │  │  └──────────────────────────┘  │  │
          │  └────────────────────────────────┘  │
          └──────────────────────────────────────┘
```

No single ring is trusted to stop everything; the data stays protected as long as any ring holds.

---

## How it Works

1. **Model the threats first** — enumerate assets, entry points, and attackers (STRIDE: spoofing, tampering, repudiation, information disclosure, denial of service, elevation of privilege). This defines what "secure" means for *this* system.
2. **Reduce the attack surface** — expose only what must be public; remove unused endpoints, debug routes, and verbose errors; put everything else behind authentication.
3. **Apply defence in depth** — place independent controls at the edge, transport, application, and data layers so no single control is a single point of failure.
4. **Enforce least privilege** — give callers and services the smallest scope or role needed (see [OAuth 2.0](oauth2.md), [Secrets Management](secrets-management.md)); never a shared admin key.
5. **Contain blast radius** — isolate tenants and users so a single compromise or bug leaks a small slice, not everything (see [Multi-Tenancy](multi-tenancy.md), [Row Level Security (RLS)](row-level-security.md)).
6. **Assume zero trust** — authenticate and authorise every request, including internal service-to-service calls (see [TLS & mTLS](tls-mtls.md)); do not trust the network.
7. **Fail secure and monitor** — deny by default on error, log audited access, and alert on anomalies (see [Distributed Tracing](distributed-tracing.md)).

---

## Advantages

- **Systematic security** — decisions are judged against a fixed set of principles, not intuition
- **Breach resilience** — defence in depth means one vulnerability does not equal full compromise
- **Bounded damage** — least privilege and blast-radius containment cap the cost of any single failure
- **Shared vocabulary** — the whole team (and the interview) can reason about "why this control exists"
- **Composable** — every concrete control in the Security section maps back to one or more principles

---

## Trade-offs

| Concern | Risk | Mitigation |
|---------|------|------------|
| **Friction** | Every layer adds latency, code, and UX friction | Apply layers where the risk is; use middleware/frameworks to keep it cheap |
| **Complexity** | More controls mean more to operate and reason about | Automate (SAST/DAST, policy-as-code) and document each layer |
| **False sense of security** | Principles are not a guarantee | Pair with threat modeling, pentests, and monitoring — never "set and forget" |
| **Over-isolation** | Too much segmentation harms usability and performance | Size the blast radius to the data's sensitivity, not uniformly |
| **Zero-trust overhead** | Verifying every internal call adds latency and cert management | Use a service mesh to transparently enforce mTLS and identity |

---

## When to Use

- **Designing any new service** — apply the principles before writing code, not after
- **Securing existing systems** — use them to audit: where is there a single layer of trust? a shared admin key?
- **Interview discussions** — the principles are the framework that ties the concrete controls together
- **Compliance and reviews** — map controls (encryption, access, audit) to principles for a defensible security posture

---

## When NOT to Use

- **As a substitute for concrete controls** — principles guide *which* controls; they do not replace them
- **As a one-time exercise** — security is continuous; principles must be re-checked as the system evolves
- **Blindly applied to low-risk internals** — a throwaway internal tool may not justify every layer; weigh the threat model

---

## Related Concepts

- [API Security (OWASP Top 10)](owasp-top-10.md) — the concrete vulnerabilities these principles prevent
- [API Authentication](api-authentication.md) — the identity layer for least privilege and zero trust
- [OAuth 2.0](oauth2.md) — scoped, least-privilege delegated access
- [DDoS & DoS Protection](ddos-protection.md) — defence in depth applied to availability
- [TLS & mTLS](tls-mtls.md) — transport layer and zero-trust service-to-service identity
- [Row Level Security (RLS)](row-level-security.md) — the data-layer backstop that contains blast radius
- [Multi-Tenancy](multi-tenancy.md) — isolation models for blast-radius containment
- [Secrets Management](secrets-management.md) — least privilege and rotation for credentials
- [Webhook Security](webhook-security.md) — verifying untrusted inbound callers
- [Rate Limiting](rate-limiting.md) — attack-surface and abuse control
- [Distributed Tracing](distributed-tracing.md) — the monitoring needed to fail secure
- STRIDE
- CIA triad
- Threat model

---

## Key Takeaways

> Security is built on principles, not a checklist: defence in depth (independent layers so one breach is not fatal), least privilege (minimum access, revoked when done), blast-radius containment (bound the damage of any failure), attack-surface reduction (expose as little as possible), threat modeling (know what and who you are defending against before coding), and zero trust (verify every request, even internal ones). They reinforce each other — least privilege and segmentation both shrink blast radius, and threat modeling reveals the attack surface that defence in depth then protects. Use them as the *why* behind every concrete control in the Security section, apply them before writing code, and re-check them as the system evolves. In an interview, lead with these principles and then show how each concrete control (JWT scopes, RLS, mTLS) implements one of them.
