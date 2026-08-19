# API Authentication

> Verifying who a caller is (authentication) and what they may do (authorization) before they can use an API, using tokens, sessions, or delegated identity.

---

## What is it?

API authentication establishes the **identity** of a client (a user, another service, or an application) before serving a request. It answers *"who are you?"*, while **authorization** answers *"are you allowed to do this?"*. The main mechanisms are: API keys, session cookies, bearer tokens (JWT), and delegated identity protocols — OAuth 2.0, OpenID Connect (OIDC), and SAML for Single Sign-On (SSO). Authentication runs before authorization, rate limiting, and business logic in the request pipeline.

---

## Problem

HTTP is **stateless** — every request is independent. Without authentication:

- Anyone can call the API and read or mutate data
- There is no way to attribute a request to a user or audit it
- There is no way to enforce per-user authorization, quotas, or rate limits
- Mobile apps, SPAs, and third-party integrations cannot safely access protected resources

The challenge is that each mechanism must solve **where the credential lives**, **how it is verified**, and **how it stays secure** — while remaining usable at scale with thousands of clients.

---

## Example

### Token-based authentication with JWT (Node.js)

```typescript
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET!; // never commit secrets

// Login — verify credentials, issue a signed token
async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user && (await verifyPassword(password, user.passwordHash));
  if (!valid) throw new Error('Invalid credentials');

  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '15m' }, // short-lived access token
  );
}

// Express middleware — verify the token on every protected request
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    req.user = jwt.verify(token, JWT_SECRET); // signature check + expiry
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Authorization — role-based check after authentication
function requireRole(role: string) {
  return (req, res, next) => {
    if (req.user.role !== role) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

app.get('/orders', authenticate, requireRole('customer'), async (req, res) => {
  const orders = await prisma.order.findMany({ where: { userId: req.user.sub } });
  res.json(orders);
});
```

---

## Architecture / Flow

```text
OAuth 2.0 Authorization Code + PKCE (the common flow for SPAs / mobile)
    ┌─────────┐      ┌────────────┐      ┌─────────────┐      ┌──────────┐
    │ Browser │      │  Frontend  │      │   Auth      │      │   API    │
    │  (user) │      │   (SPA)    │      │   Server    │      │  Server  │
    └────┬────┘      └─────┬──────┘      └──────┬──────┘      └────┬─────┘
         │ 1. login        │                    │                  │
         │────────────────►│ 2. authorize       │                  │
         │                 │───────────────────►│                  │
         │ 3. consent page │                    │                  │
         │◄────────────────│                    │                  │
         │ 4. authenticate │                    │                  │
         │────────────────►│                    │                  │
         │ 5. auth code    │ 6. code + PKCE     │                  │
         │◄────────────────│───────────────────►│                  │
         │                 │ 7. access token    │                  │
         │                 │◄───────────────────│                  │
         │                 │ 8. GET /orders + Bearer token          │
         │                 │──────────────────────────────────────►│
         │                 │ 9. verify token (signature / JWKS)    │
         │                 │◄──────────────────────────────────────│
```

---

## How it Works

1. **The client presents a credential** — API key, username/password, or a bearer token — on each request (usually in the `Authorization` header).
2. **The server verifies the credential** — either by checking a database (sessions, API keys) or by validating a cryptographic signature (JWT via `jsonwebtoken` or an OIDC JWKS endpoint).
3. **Authentication passes** — the server now knows *who* the caller is and attaches that identity (`req.user`) to the request context.
4. **Authorization is checked** — role-based or permission-based rules decide if the identity may perform the requested action (`requireRole` middleware).
5. **Sessions vs tokens** — session cookies store an opaque reference server-side (revocable, stateful); JWTs are self-contained (stateless, but harder to revoke).
6. **Delegated flows** — OAuth 2.0 lets an app obtain a token on behalf of a user *without* seeing their password; OIDC adds an identity layer (ID token) on top.

---

## Advantages

- **Stateless scalability (JWT)** — the API server verifies tokens without a session store; any instance can serve any request
- **Delegation without passwords (OAuth)** — third-party apps never see user credentials; tokens are scoped and expiring
- **Single Sign-On (OIDC/SAML)** — one login works across many applications; centralised identity and revocation
- **Per-request identity** — every request carries the caller identity, enabling auditing, per-user rate limits, and ownership-based authorization
- **Standardised** — OAuth 2.0 / OIDC are mature, widely implemented standards with libraries in every language

---

## Trade-offs

| Concern | Risk | Mitigation |
|---------|------|------------|
| **JWT revocation** | Stateless tokens are valid until expiry; cannot kill a compromised token | Short-lived tokens + refresh tokens; token blacklist; check `jti`/`iat` against a deny list |
| **Token theft** | Stolen tokens are usable from any client | HTTPS only; secure/httpOnly cookies; short TTLs; rotate refresh tokens; PKCE for SPAs |
| **Secret management** | Signing keys and client secrets leak into code/repos | Env vars, vault/secret manager, periodic key rotation |
| **Statefulness** | Sessions require a store (Redis/DB) and add a lookup per request | Use JWTs when statelessness matters; sessions when revocation matters |
| **Federated complexity** | OAuth/OIDC flows, scopes, and consent add operational overhead | Use a managed IdP (Auth0, Cognito, Keycloak); understand the flow before building it |

---

## When to Use

- **Public APIs / third-party integrations** — OAuth 2.0 client credentials or API keys
- **SPAs and mobile apps** — OAuth 2.0 Authorization Code + PKCE with short-lived access tokens and refresh tokens
- **Multiple applications, one login (SSO)** — OIDC for user authentication, SAML for enterprise identity providers
- **Server-to-server communication** — API keys, mTLS, or OAuth client-credentials grant
- **User-facing APIs with per-user data** — JWT bearer tokens with `sub` (subject) claims for ownership checks

---

## When NOT to Use

- **Internal-only services with a trusted network** — full OAuth/OIDC is overkill; mTLS or a simple API key may suffice
- **Public read-only data** — no authentication needed at all (e.g. a public product catalog)
- **Short-lived internal jobs** — mutual TLS or shared secrets are simpler than a full identity provider
- **Applications requiring instant revocation** — if you must kill a token immediately, sessions or a token blacklist beat stateless JWTs
- **Simple first-party apps** — a session cookie over HTTPS may be simpler than the full OAuth dance

---

## Related Concepts

- [REST](rest.md) — authentication sits in the middleware stack of every REST API
- [GraphQL](graphql.md) — the same token/session mechanisms protect GraphQL endpoints
- [gRPC](grpc.md) — authentication applies to inter-service RPC (mTLS, bearer tokens)
- [Rate Limiting](rate-limiting.md) — API keys/identities enable per-client rate limits
- [API Versioning](api-versioning.md) — authentication is typically applied across all API versions
- [Error Handling (Express)](error-handling.md) — 401 (unauthenticated) and 403 (unauthorized) responses flow through centralised error middleware
- [Distributed Tracing](distributed-tracing.md) — propagate the caller identity in trace context for audited request logs
- [OAuth 2.0](oauth2.md) — the delegated authorization framework for scoped, token-based access
- [OpenID Connect (OIDC)](oidc.md) — the identity layer on top of OAuth 2.0 for authentication and SSO
- SAML
- JWT
- JSON Web Keys (JWKS)

---

## Key Takeaways

> Authentication answers "who are you?" and authorization answers "are you allowed?" — never conflate the two; both must be enforced on every protected route. Stateless JWTs scale horizontally but are hard to revoke; session cookies are revocable but require a store — pick based on your revocation and statelessness needs. Use OAuth 2.0 to let third parties act on a user's behalf without ever seeing their password, and OpenID Connect (OIDC) on top for identity and single sign-on. Always serve over HTTPS, keep signing keys in a secret manager, use short-lived tokens with refresh, and return 401 for missing/invalid credentials and 403 for authenticated-but-forbidden requests.
