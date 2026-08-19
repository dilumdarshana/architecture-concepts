# TLS & mTLS

> Transport Layer Security (TLS) encrypts data in transit between two parties; mutual TLS (mTLS) additionally verifies both parties' identities using certificates.

---

## What is it?

**TLS** is the cryptographic protocol that secures communication over a network — it provides **confidentiality** (encryption), **integrity** (tamper detection), and **authentication** (the server proves its identity via a certificate). HTTPS is HTTP over TLS. **Mutual TLS (mTLS)** extends this so *both* sides present certificates: the client authenticates to the server and the server authenticates to the client. mTLS is the standard way to secure service-to-service communication in a zero-trust architecture.

---

## Problem

Without transport security:

- Traffic is **plaintext** — anyone on the network path (a router, a compromised host, a shared network) can read passwords, tokens, and data
- Traffic can be **modified in transit** — an attacker can alter requests or responses undetected
- There is no way to verify **who you are talking to** — a client can be tricked into connecting to a fake server (man-in-the-middle)
- Service-to-service calls on an internal network are assumed safe, but a single compromised host exposes everything

TLS solves the first three; mTLS solves the fourth by authenticating every service with a certificate rather than trusting the network.

---

## Example

### TLS handshake (simplified)

```text
Client                              Server
  │ 1. ClientHello (TLS version, ciphers)  │
  │───────────────────────────────────────►│
  │ 2. ServerHello + certificate           │
  │◄───────────────────────────────────────│
  │ 3. Verify certificate (CA chain)       │
  │ 4. Key exchange (derive session key)   │
  │───────────────────────────────────────►│
  │ 5. Finished (encrypted)                │
  │◄───────────────────────────────────────│
  │ 6. Application data (encrypted)        │
  │◄───────────────────────────────────────►│
```

### Node.js — HTTPS server with TLS

```typescript
import https from 'https';
import { readFileSync } from 'fs';
import express from 'express';

const app = express();
app.get('/', (_req, res) => res.json({ ok: true }));

https
  .createServer(
    {
      key: readFileSync('/etc/tls/server.key'),   // private key
      cert: readFileSync('/etc/tls/server.crt'),  // public certificate
    },
    app,
  )
  .listen(443);
```

### Node.js — mTLS client (service-to-service)

```typescript
import https from 'https';

// The client presents its own certificate; the server verifies it
const req = https.request(
  {
    hostname: 'payment-service.internal',
    port: 443,
    key: readFileSync('/etc/tls/client.key'),
    cert: readFileSync('/etc/tls/client.crt'),
    ca: readFileSync('/etc/tls/ca.crt'), // trust the internal CA
    rejectUnauthorized: true,
  },
  (res) => { /* ... */ },
);
```

---

## Architecture / Flow

```text
Public traffic (TLS):
  Browser ──HTTPS──► Load Balancer ──► API Server
                     (terminates TLS, presents public cert)

Internal traffic (mTLS):
  Order Service ──mTLS──► Payment Service
  (presents its cert)     (verifies cert against internal CA)
```

In a service mesh (Istio, Linkerd), mTLS is often handled transparently by sidecar proxies — the application code does not manage certificates directly.

---

## How it Works

1. **The client connects and sends a ClientHello** — TLS version and supported cipher suites.
2. **The server responds with its certificate** — a public key signed by a Certificate Authority (CA).
3. **The client verifies the certificate** — checks the signature against trusted CAs, the hostname, and expiry.
4. **Both sides derive a shared session key** — via key exchange (e.g. ECDHE); the actual data is encrypted with symmetric encryption for speed.
5. **Application data flows encrypted** — with integrity protection (MAC) so tampering is detected.
6. **In mTLS, the server also requests the client's certificate** — the client presents its own cert, which the server verifies against its trusted CA, authenticating the client.

---

## Advantages

- **Confidentiality** — data is unreadable to anyone on the network path
- **Integrity** — tampering is detected and rejected
- **Server authentication** — clients can verify they are talking to the real server (prevents man-in-the-middle)
- **Mutual authentication (mTLS)** — every service proves its identity; no reliance on network trust
- **Zero-trust enabler** — mTLS lets you treat the network as hostile and authenticate at every hop

---

## Trade-offs

| Concern | Risk | Mitigation |
|---------|------|------------|
| **Certificate management** | Expired or misconfigured certs cause outages | Automated issuance/rotation (Let's Encrypt, cert-manager); monitoring |
| **Handshake latency** | TLS handshake adds round trips on new connections | TLS 1.3 (1-RTT), session resumption, connection pooling/keep-alive |
| **Operational complexity (mTLS)** | Every service needs a cert; rotation at scale is hard | Service mesh (Istio/Linkerd) automates mTLS; short-lived certs |
| **CPU overhead** | Encryption costs CPU | Modern hardware acceleration; TLS termination at the edge |
| **Misconfiguration** | Weak ciphers, expired CAs, or disabled verification weaken security | Enforce TLS 1.2+, strong cipher suites, `rejectUnauthorized: true` |

---

## When to Use

- **Any public-facing service** — HTTPS is mandatory for all web traffic
- **Service-to-service communication** — mTLS for internal APIs, especially across trust boundaries
- **Zero-trust architectures** — authenticate every request regardless of network location
- **Regulated data** — PCI, HIPAA, and GDPR all require encryption in transit
- **Microservices on shared infrastructure** — mTLS prevents a compromised host from impersonating services

---

## When NOT to Use

- **Public clients (browsers, mobile apps)** — mTLS requires distributing client certs, which is impractical; use TLS + [OAuth 2.0](oauth2.md)/[OIDC](oidc.md) instead
- **Simple internal networks with full trust** — mTLS adds operational overhead; weigh it against the threat model
- **Performance-critical paths** — if handshake overhead matters, terminate TLS at the edge and use mTLS only at trust boundaries

---

## Related Concepts

- [API Authentication](api-authentication.md) — TLS authenticates the *channel*; OAuth/OIDC authenticate the *caller*
- [OAuth 2.0](oauth2.md) — client credentials grant is often combined with mTLS for server-to-server auth
- [gRPC](grpc.md) — gRPC strongly recommends TLS; mTLS is the standard for gRPC inter-service security
- [Secrets Management](secrets-management.md) — certificates are secrets that must be stored and rotated securely
- [API Security (OWASP Top 10)](owasp-top-10.md) — transport security complements application-level controls
- [Connection Pooling](connection-pooling.md) — keep-alive reduces TLS handshake overhead
- HTTPS
- Certificate Authority (CA)
- Service Mesh (Istio, Linkerd)

---

## Key Takeaways

> TLS encrypts and authenticates data in transit — confidentiality, integrity, and server authentication — and HTTPS is mandatory for any public service. Mutual TLS (mTLS) extends this so both parties present certificates, making it the standard for secure service-to-service communication and zero-trust architectures. The main cost is certificate management and handshake latency; use TLS 1.3, session resumption, and connection pooling to mitigate. For public clients, use TLS + OAuth/OIDC rather than mTLS. In a service mesh, mTLS is handled transparently by sidecar proxies.