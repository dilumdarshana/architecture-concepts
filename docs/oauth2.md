# OAuth 2.0

> An authorization framework that lets an application obtain limited access to a user's resources on another service, without ever seeing the user's password.

---

## What is it?

OAuth 2.0 is a **delegated authorization** protocol. It lets a client application (a web app, mobile app, or another service) obtain an **access token** that grants scoped, time-limited access to resources owned by a user and hosted by a resource server. The user authenticates directly with an **authorization server** and approves the requested **scopes** — the client never receives the user's credentials. OAuth 2.0 is about *authorization* (what the client may do); it is not an authentication protocol.

---

## Problem

Before OAuth, a third-party app that wanted to act on a user's behalf (e.g. "post to my feed", "read my orders") had to ask for the user's password and store it. That is dangerous:

- The app can do **anything** the user can — no scoping
- The password is stored by a party that may not secure it
- The user cannot revoke one app without changing their password everywhere
- There is no audit trail of what each app did

OAuth 2.0 solves this by replacing shared passwords with **scoped, expiring tokens** issued by an authorization server the user trusts.

---

## Example

### Client Credentials Grant (server-to-server)

The simplest flow — a service obtains a token for itself, no user involved:

```typescript
// POST /token
// grant_type=client_credentials&client_id=...&client_secret=...
const res = await fetch('https://auth.example.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.CLIENT_ID!,
    client_secret: process.env.CLIENT_SECRET!,
    scope: 'orders:read',
  }),
});

const { access_token, expires_in } = await res.json();

// Use the token on the protected API
const orders = await fetch('https://api.example.com/orders', {
  headers: { Authorization: `Bearer ${access_token}` },
});
```

### Validating an access token (resource server)

```typescript
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

// Fetch the authorization server's public keys from its JWKS endpoint
const client = jwksClient({ jwksUri: 'https://auth.example.com/.well-known/jwks.json' });

async function verifyAccessToken(token: string) {
  const decoded = jwt.decode(token, { complete: true });
  const key = await client.getSigningKey(decoded.header.kid);
  return jwt.verify(token, key.getPublicKey(), {
    issuer: 'https://auth.example.com',
    audience: 'api.example.com', // token was issued for this API
  });
}
```

---

## Architecture / Flow

### Roles

| Role | Description |
|------|-------------|
| **Resource Owner** | The user who owns the data and grants access |
| **Client** | The application requesting access (web app, SPA, mobile, service) |
| **Authorization Server** | Issues tokens after authenticating the user and checking consent |
| **Resource Server** | Hosts the protected data; validates the access token before serving |

### Authorization Code + PKCE (SPAs and mobile apps)

```text
    ┌─────────┐      ┌────────────┐      ┌─────────────┐      ┌──────────┐
    │ Browser │      │  Client    │      │   Auth      │      │ Resource │
    │  (user) │      │   (SPA)    │      │   Server    │      │  Server  │
    └────┬────┘      └─────┬──────┘      └──────┬──────┘      └────┬─────┘
         │ 1. login        │                    │                  │
         │────────────────►│ 2. authorize +     │                  │
         │                 │    code_challenge  │                  │
         │                 │───────────────────►│                  │
         │ 3. consent page │                    │                  │
         │◄────────────────│                    │                  │
         │ 4. authenticate │                    │                  │
         │────────────────►│                    │                  │
         │ 5. auth code    │ 6. code +          │                  │
         │◄────────────────│    code_verifier   │                  │
         │                 │───────────────────►│                  │
         │                 │ 7. access token    │                  │
         │                 │◄───────────────────│                  │
         │                 │ 8. GET /orders + Bearer token          │
         │                 │──────────────────────────────────────►│
         │                 │ 9. verify token (signature / JWKS)    │
         │                 │◄──────────────────────────────────────│
```

---

## How it Works

1. **The client requests authorization** — it redirects the user to the authorization server with its `client_id`, requested `scope`, and a `redirect_uri`.
2. **The user authenticates and consents** — the authorization server verifies the user's identity and shows the requested scopes; the user approves or denies.
3. **The authorization server returns an authorization code** — a short-lived, single-use code sent to the client's `redirect_uri`.
4. **The client exchanges the code for tokens** — it calls the token endpoint with the code plus its credentials (and the PKCE `code_verifier` for public clients).
5. **The client receives an access token** (and optionally a refresh token) — the access token is sent as `Authorization: Bearer <token>` on API calls.
6. **The resource server validates the token** — checks the signature against the authorization server's JWKS, plus `iss`, `aud`, `exp`, and `scope`.
7. **On expiry, the client refreshes** — it exchanges the refresh token for a new access token without re-prompting the user.

---

## Advantages

- **No password sharing** — the client never sees or stores user credentials
- **Scoped access** — tokens carry only the scopes the user approved (`orders:read`, not `orders:write`)
- **Revocable** — the user can revoke a client's access without changing their password
- **Time-limited** — short-lived access tokens limit the blast radius of a leak
- **Standardised** — a mature spec with libraries and managed providers (Auth0, Cognito, Keycloak) in every language

---

## Trade-offs

| Concern | Risk | Mitigation |
|---------|------|------------|
| **Complexity** | Multiple grant types, endpoints, and flows to understand | Use a managed IdP; start with one grant type per client kind |
| **Token theft** | A stolen access token is usable until expiry | HTTPS only; short TTLs; PKCE; rotate refresh tokens; bind tokens to clients |
| **Refresh token abuse** | A stolen refresh token grants long-lived access | Rotation (each refresh issues a new token, invalidating the old); revocation lists |
| **Redirect URI attacks** | An attacker registers a malicious `redirect_uri` to capture codes | Validate exact `redirect_uri`; use PKCE so a captured code is useless |
| **Not authentication** | OAuth alone does not prove *who* the user is | Layer [OpenID Connect (OIDC)](oidc.md) on top for identity |

---

## When to Use

- **Third-party integrations** — let external apps act on a user's behalf with scoped access
- **SPAs and mobile apps** — Authorization Code + PKCE (no client secret can be kept secret in a browser)
- **Server-to-server** — Client Credentials grant for service-to-service calls
- **Delegated access to your API** — you are the resource server and want to control what clients can do
- **Multi-tenant apps** — one authorization server serving many client applications

---

## When NOT to Use

- **First-party apps with a single login** — a session cookie or simple JWT is simpler than the full OAuth dance
- **Authentication-only needs** — if you only need to verify *who* a user is, use [OpenID Connect (OIDC)](oidc.md) or a session
- **Internal trusted services** — mTLS or API keys are simpler than an authorization server
- **Public read-only data** — no authorization needed at all

---

## Related Concepts

- [API Authentication](api-authentication.md) — the overview of all authentication/authorization mechanisms
- [OpenID Connect (OIDC)](oidc.md) — the identity layer built on top of OAuth 2.0
- [REST](rest.md) — OAuth-protected APIs are typically REST resources
- [gRPC](grpc.md) — bearer tokens also protect inter-service RPC
- [Rate Limiting](rate-limiting.md) — scopes and client identity enable per-client limits
- [Distributed Tracing](distributed-tracing.md) — propagate client identity in trace context for audit
- Authorization Code + PKCE
- Client Credentials
- Refresh Tokens
- JWKS

---

## Key Takeaways

> OAuth 2.0 is delegated authorization: a client gets a scoped, expiring access token from an authorization server instead of the user's password. Use Authorization Code + PKCE for SPAs and mobile apps, Client Credentials for server-to-server, and always validate tokens on the resource server against the authorization server's JWKS (check `iss`, `aud`, `exp`, `scope`). OAuth 2.0 authorizes *what* a client may do — it does not authenticate *who* the user is; add [OpenID Connect (OIDC)](oidc.md) for identity. Protect tokens with HTTPS, short TTLs, refresh-token rotation, and PKCE.