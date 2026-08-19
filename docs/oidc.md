# OpenID Connect (OIDC)

> An identity layer built on top of OAuth 2.0 that lets clients verify who a user is and obtain basic profile information, enabling single sign-on across applications.

---

## What is it?

OpenID Connect (OIDC) extends [OAuth 2.0](oauth2.md) with an **authentication** layer. Where OAuth 2.0 issues an access token that authorizes *what* a client may do, OIDC additionally issues an **ID token** — a signed JWT that proves *who* the user is. OIDC standardises discovery, user claims, and session management, making it the de-facto protocol for Single Sign-On (SSO) on the web.

---

## Problem

OAuth 2.0 solves delegation but leaves identity unspecified:

- An access token is opaque to the client — it cannot tell *who* the user is
- There is no standard way to fetch user profile data (name, email, picture)
- There is no standard way for a client to discover an authorization server's endpoints or keys
- Each provider invents its own login flow, breaking single sign-on across applications

OIDC standardises all of this: a standard ID token, a standard UserInfo endpoint, standard scopes and claims, and standard discovery metadata.

---

## Example

### ID token (JWT)

```text
Header:  { "alg": "RS256", "kid": "key-1", "typ": "JWT" }
Payload: {
  "iss": "https://auth.example.com",   // issuer
  "sub": "user-123",                   // subject — the user's stable ID
  "aud": "my-app",                     // audience — the client
  "exp": 1710000000,                   // expiry
  "iat": 1709996400,                   // issued at
  "nonce": "abc123",                   // replay protection
  "email": "user@example.com",
  "email_verified": true,
  "name": "Jane Doe"
}
```

### Validating an ID token (Node.js)

```typescript
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

const client = jwksClient({
  jwksUri: 'https://auth.example.com/.well-known/jwks.json',
});

async function verifyIdToken(idToken: string) {
  const decoded = jwt.decode(idToken, { complete: true });
  const key = await client.getSigningKey(decoded.header.kid);

  return jwt.verify(idToken, key.getPublicKey(), {
    issuer: 'https://auth.example.com',
    audience: 'my-app',          // must match our client_id
    algorithms: ['RS256'],
  });
}
```

### Fetching user profile from the UserInfo endpoint

```typescript
const res = await fetch('https://auth.example.com/userinfo', {
  headers: { Authorization: `Bearer ${accessToken}` },
});
const profile = await res.json(); // { sub, name, email, picture, ... }
```

---

## Architecture / Flow

```text
OIDC Authorization Code flow (same shape as OAuth 2.0, plus ID token)
    ┌─────────┐      ┌────────────┐      ┌─────────────┐
    │ Browser │      │  Client    │      │   IdP       │
    │  (user) │      │   (app)    │      │  (OIDC)     │
    └────┬────┘      └─────┬──────┘      └──────┬──────┘
         │ 1. login        │                    │
         │────────────────►│ 2. authorize       │
         │                 │    scope=openid    │
         │                 │    profile email   │
         │                 │───────────────────►│
         │ 3. authenticate │                    │
         │────────────────►│                    │
         │ 4. auth code    │ 5. code exchange   │
         │◄────────────────│───────────────────►│
         │                 │ 6. ID token +      │
         │                 │    access token    │
         │                 │◄───────────────────│
         │                 │ 7. verify ID token │
         │                 │    (signature,     │
         │                 │    iss, aud, nonce)│
         │                 │ 8. GET /userinfo   │
         │                 │    (Bearer token)  │
         │                 │───────────────────►│
```

---

## How it Works

1. **The client redirects the user to the IdP** with `scope=openid` (plus `profile`, `email`, etc.) and a `nonce`.
2. **The user authenticates** at the IdP and consents to the requested scopes.
3. **The IdP returns an authorization code** to the client's `redirect_uri`.
4. **The client exchanges the code** at the token endpoint and receives an **ID token** (JWT) plus an access token.
5. **The client validates the ID token** — signature via JWKS, plus `iss`, `aud`, `exp`, and `nonce` (replay protection).
6. **The client reads identity claims** directly from the ID token, or calls the **UserInfo endpoint** with the access token for additional profile data.
7. **Single sign-on** — the IdP maintains a session; subsequent apps redirect the user and they are already authenticated, so no password prompt.

---

## Advantages

- **Standardised identity** — one protocol for authentication, profile, and discovery across every provider
- **Single Sign-On** — one login at the IdP works across all connected applications
- **Verified identity in a signed token** — the ID token is cryptographically verifiable without a server round trip
- **Discovery** — `/.well-known/openid-configuration` exposes endpoints, scopes, and JWKS automatically
- **Replay protection** — the `nonce` binds the ID token to the original login request

---

## Trade-offs

| Concern | Risk | Mitigation |
|---------|------|------------|
| **Trust in the IdP** | The IdP controls identity; an IdP breach affects every app | Use a reputable managed IdP; monitor; rotate signing keys |
| **ID token size** | Large claims bloat the token and every request | Keep claims minimal; fetch extra data from UserInfo |
| **Clock skew** | `exp`/`iat` validation can fail with skewed clocks | Allow a small leeway (e.g. 30s) in validation |
| **Session logout** | SSO sessions are hard to end across all apps | Use RP-initiated logout and `end_session_endpoint` |
| **Complexity** | OAuth 2.0 + OIDC flows, discovery, and validation are non-trivial | Use a library or managed IdP (Auth0, Cognito, Keycloak) |

---

## When to Use

- **Single Sign-On across multiple applications** — one login, many apps
- **User-facing apps that need identity** — you must know *who* the user is, not just what they may do
- **Consumer login** — "Sign in with Google / GitHub / Apple" uses OIDC under the hood
- **Enterprise SSO** — OIDC (or SAML) connects to corporate identity providers
- **Mobile and SPA authentication** — OIDC on top of Authorization Code + PKCE

---

## When NOT to Use

- **Server-to-server calls** — no user identity involved; use OAuth 2.0 Client Credentials
- **Simple first-party login** — a session cookie or plain JWT may be simpler than an IdP
- **Authorization-only needs** — if you never need to know *who* the user is, OAuth 2.0 alone suffices
- **Legacy enterprise environments** — some organisations still require SAML instead of OIDC

---

## Related Concepts

- [OAuth 2.0](oauth2.md) — the authorization framework OIDC builds on
- [API Authentication](api-authentication.md) — the overview of all authentication/authorization mechanisms
- [REST](rest.md) — OIDC-protected APIs are typically REST resources
- [API Versioning](api-versioning.md) — authentication applies across all API versions
- [Distributed Tracing](distributed-tracing.md) — propagate the user's `sub` in trace context for audit
- ID Token
- UserInfo Endpoint
- Discovery (`/.well-known/openid-configuration`)
- JWKS
- SAML

---

## Key Takeaways

> OpenID Connect adds an identity layer to [OAuth 2.0](oauth2.md): the **ID token** is a signed JWT that proves *who* the user is, while the access token authorizes *what* the client may do. Always request `scope=openid`, validate the ID token's signature (JWKS) and `iss`/`aud`/`exp`/`nonce`, and use the UserInfo endpoint for profile data. OIDC is the standard for single sign-on — one login at the IdP works across all connected applications. Use OAuth 2.0 Client Credentials for server-to-server calls where no user identity exists.