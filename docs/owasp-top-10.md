# API Security (OWASP Top 10)

> The OWASP Top 10 web application security risks — injection, broken authentication, and access control flaws — and how to defend against them in API-driven applications.

---

## What is it?

The **OWASP Top 10** is a widely adopted list of the most critical web application security risks, maintained by the Open Worldwide Application Security Project. It is not an exhaustive checklist — it is a ranked snapshot of the highest-frequency, highest-impact vulnerability classes found in real applications. For API-driven systems, the most relevant risks are: **broken access control (A01)**, **security misconfiguration (A05)**, **injection (A03)**, **broken authentication (A07)**, and **server-side request forgery / SSRF (A10)**. Understanding the list means knowing *where* APIs most often fail and the defence-in-depth measures that close those gaps.

---

## Problem

APIs expose business logic and data over a public network. Without deliberate security design, the same weaknesses recur across nearly every application:

- An endpoint trusts user input and passes it into a SQL query, a shell command, or an HTTP fetch — injection or SSRF
- A token is validated incorrectly or not at all — broken authentication
- A route checks that a user is logged in but not *whether they may access this resource* — broken object-level authorization (IDOR)
- Secrets, debug endpoints, and verbose error messages are left in production — security misconfiguration
- Logging and monitoring are missing, so a breach is discovered weeks later — insufficient logging

The OWASP Top 10 names these classes so teams can test for and fix them systematically rather than reactively.

---

## Example

### SQL Injection (A03) — vulnerable vs safe

```typescript
// Vulnerable — user input concatenated into SQL
app.get('/products', async (req, res) => {
  const rows = await db.query(
    `SELECT * FROM products WHERE name = '${req.query.name}'`, // attacker injects "'; DROP TABLE products; --"
  );
  res.json(rows);
});

// Safe — parameterised query (Prisma / Kysely)
app.get('/products', async (req, res) => {
  const products = await prisma.product.findMany({
    where: { name: String(req.query.name ?? '') }, // Prisma parameterises automatically
  });
  res.json(products);
});
```

### Broken Object-Level Authorization (A01) — IDOR

```typescript
// Vulnerable — any authenticated user can read any order
app.get('/orders/:id', authenticate, async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  res.json(order);
});

// Safe — the resource is scoped to the authenticated user
app.get('/orders/:id', authenticate, async (req, res) => {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, userId: req.user.sub }, // ownership check
  });
  if (!order) return res.status(404).json({ error: 'Not found' }); // 404, not 403 — don't leak existence
  res.json(order);
});
```

---

## Architecture / Flow

```text
Attacker ──► Request ──► [WAF / rate limit] ──► [AuthN: verify token] ──► [AuthZ: ownership/role] ──► [Input validation] ──► [Business logic] ──► [Parameterised DB / safe fetch] ──► Response
                              │                        │                        │
                          A07 broken               A01 broken access        A03 injection /
                          auth                     control (IDOR)          A10 SSRF
```

Defence layers in order: every request is authenticated, then authorised against the *resource*, then validated, then executed with parameterised queries and restricted outbound access.

---

## How it Works

1. **Authenticate every request** — verify the caller's identity (see [API Authentication](api-authentication.md)) before any business logic runs; never trust client-supplied identity fields.
2. **Authorise against the resource** — check object ownership and role/scope on every protected route (IDOR prevention); return 404 for resources the caller may not see.
3. **Validate and sanitise input** — enforce types, lengths, and whitelists at the boundary; never concatenate input into SQL, OS commands, or HTML.
4. **Use parameterised queries** — ORMs (Prisma, Kysely) and prepared statements defeat SQL injection by separating query structure from data.
5. **Restrict outbound requests** — validate URLs against an allowlist and block internal addresses to prevent SSRF.
6. **Configure securely** — disable debug mode, hide stack traces, set security headers (CSP, `SameSite` cookies), and use HTTPS with HSTS.
7. **Log and monitor** — structured audit logs with request IDs enable detection and investigation (see [Distributed Tracing](distributed-tracing.md)).

---

## Advantages

- **Prevents the most exploited vulnerability classes** — the Top 10 maps to the majority of real-world breaches
- **Gives teams a shared vocabulary** — security reviews, bug bounties, and tooling all reference the same list
- **Actionable and testable** — each risk has concrete detection techniques (SAST, DAST, manual testing) and fixes
- **Promotes defence in depth** — no single layer is trusted; authN, authZ, validation, and monitoring each back the others

---

## Trade-offs

| Concern | Risk | Mitigation |
|---------|------|------------|
| **Not exhaustive** | The Top 10 omits emerging or context-specific threats | Treat it as a baseline, not a complete security program |
| **False sense of security** | Passing the Top 10 does not mean the app is secure | Combine with threat modelling, pentests, and dependency scanning |
| **Overhead** | Validation, authZ checks, and headers add code and latency | Apply at the framework/middleware layer; automate with SAST/DAST |
| **Weaponised error messages** | Verbose errors help attackers enumerate the system | Centralised error middleware that returns generic messages to clients, detailed logs server-side |

---

## When to Use

- **Any public-facing API** — REST, GraphQL, or gRPC that accepts untrusted input
- **Applications handling user data** — especially personal, financial, or health data
- **During design and code review** — apply the Top 10 as a review checklist for every new endpoint
- **Before release** — run automated scanners and manual testing against the Top 10 classes
- **Team onboarding** — the list is a compact curriculum for new engineers joining security-sensitive projects

---

## When NOT to Use

- **As a replacement for threat modelling** — the Top 10 is a starting list, not a full risk assessment of *your* system
- **As a certification** — being "OWASP-compliant" is meaningless; the list describes risks, not a standard to pass
- **In isolation from testing** — the list guides testing but does not replace SAST/DAST, dependency scanning, and pentests

---

## Related Concepts

- [API Authentication](api-authentication.md) — authentication is the first defence against broken authentication (A07)
- [OAuth 2.0](oauth2.md) — token-based authorization and scopes reduce broken access control risk
- [OpenID Connect (OIDC)](oidc.md) — verified identity prevents spoofing and session attacks
- [Rate Limiting](rate-limiting.md) — throttles credential stuffing and brute-force login attempts
- [Error Handling (Express)](error-handling.md) — centralised errors prevent sensitive information leakage
- [REST](rest.md) — the API surface where these risks most commonly appear
- [GraphQL](graphql.md) — GraphQL has additional risks (introspection, query depth/amplification)
- [Distributed Tracing](distributed-tracing.md) — audit and detection via correlated request logs
- SQL Injection
- XSS
- CSRF
- SSRF
- IDOR

---

## Key Takeaways

> The OWASP Top 10 is the baseline for securing APIs: broken access control (A01) and broken authentication (A07) are the two most common and damaging risks, so authenticate every request and authorise against the specific resource (IDOR) on every route. Defeat injection (A03) with parameterised queries and ORMs — never concatenate user input into SQL, commands, or HTML. Validate input at the boundary and restrict outbound requests to prevent SSRF (A10). Harden configuration (A05): no debug mode, no leaked stack traces, security headers, HTTPS. The Top 10 is a starting checklist — combine it with threat modelling, automated scanning, dependency updates, and audited logging. Treat the Top 10 as a baseline, not a pass/fail standard.