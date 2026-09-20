# DDoS & DoS Protection

> Defending against denial-of-service attacks — volumetric floods, protocol exhaustion, and application-layer abuse — with layered mitigation from the edge (CDN/WAF) down to the application (rate limiting, timeouts, connection limits).

---

## What is it?

A **Denial of Service (DoS)** attack makes a service unavailable to legitimate users by exhausting some resource — bandwidth, sockets, CPU, memory, or database connections. A **Distributed DoS (DDoS)** does the same from many machines (a botnet), which makes it harder to block by source. Attacks fall into three classes, each targeting a different resource and requiring a different defence:

| Class | Target | Examples | Where to defend |
|-------|--------|----------|-----------------|
| **Volumetric** | Bandwidth | UDP flood, ICMP flood, DNS/NTP amplification | Network edge — CDN, anycast scrubbing |
| **Protocol** | Connection state | SYN flood, ACK flood, half-open connections | Load balancer, firewalls, SYN cookies, connection limits |
| **Application (L7)** | App resources | HTTP flood, Slowloris, slow POST, oversized payloads | WAF, rate limiting, request timeouts, body limits |

DoS protection is not a single control — it is **defence in depth**: each layer absorbs a different class of attack before it reaches the next.

---

## Problem

DDoS attacks are cheap to launch and expensive to absorb. A few dollars of rented botnet traffic can take down a service that has no mitigation in place:

- The network pipe saturates and legitimate packets are dropped — volumetric flood
- The server's socket/connection table fills with half-open connections — protocol exhaustion
- Slow, incomplete requests tie up every request handler and DB connection — application-layer exhaustion (Slowloris)
- A single client floods an expensive endpoint, consuming all CPU or queue capacity

Worse, an attack can trigger cascading failures: a flooded service slows down, callers time out and retry (see [Retry Pattern](retry-pattern.md)), and the retry storm overloads everything downstream.

---

## Example

### Illustrative — three attacks, three defences

```text
Volumetric (bandwidth):  Botnet → 10 Gbps UDP flood → your 1 Gbps uplink → saturated
  Defence: CDN / anycast network absorbs the flood at edge PoPs, far from your origin.

Protocol (connection):   Botnet → SYN flood → your server's half-open queue fills
  Defence: load balancer / SYN cookies + server.maxConnections drops excess sockets.

Application (L7):        Botnet → Slowloris → opens sockets, sends headers 1 byte/sec
  Defence: requestTimeout / headersTimeout close slow connections; WAF + rate limit block the rest.
```

### SYN flood / SYN cookies

A SYN flood exploits the TCP three-way handshake: the attacker sends many `SYN` packets but never completes the handshake, filling the server's half-open connection queue so real connections are refused.

```text
Normal handshake                      SYN flood
  Client            Server              Attacker           Server
    │──SYN───────────►│                   │──SYN──────────────►│  (many, spoofed)
    │◄──SYN-ACK───────│                   │──SYN──────────────►│
    │──ACK───────────►│                   │──SYN──────────────►│  ← queue fills,
    │  connection up  │                   │   (no ACK ever)    │    real SYN dropped
```

Two defences handle this at the connection layer:

- **SYN cookies** — the server encodes the connection state into the `SYN-ACK` sequence number and allocates no queue entry until the final `ACK` returns. Spoofed SYNs cost nothing because state is only created for connections that complete the handshake.
- **SYN proxy** — a middlebox (load balancer or WAF) completes the handshake on the client's behalf and only forwards fully validated connections to the origin.

These only stop *protocol* exhaustion. They do nothing against volumetric (bandwidth) floods or application-layer (Slowloris / HTTP flood) attacks — those still need CDN/anycast scrubbing, WAF, and rate limiting respectively.

### Node.js server hardening (TypeScript)

Application-layer and protocol attacks are partly mitigated at the Node.js `http.Server` level:

```typescript
import express from 'express';
import http from 'node:http';
import rateLimit from 'express-rate-limit';

const app = express();

// 1. Cap the request body — oversized payloads exhaust memory
app.use(express.json({ limit: '100kb' }));

// 2. Rate limit at the application layer (see rate-limiting.md)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

app.get('/health', (_req, res) => res.json({ ok: true }));

// 3. Harden the HTTP server against slow and connection-exhaustion attacks
const server = http.createServer(app);

server.requestTimeout = 10_000;   // Slowloris / slow POST: cap time to receive the full request
server.headersTimeout = 10_000;   // Cap time to receive request headers
server.keepAliveTimeout = 5_000;  // Release idle keep-alive sockets sooner
server.maxHeadersCount = 100;     // Reject requests with absurd header counts
server.maxConnections = 1_000;    // Drop connections beyond the limit (protocol exhaustion)

server.listen(3000);
```

`requestTimeout` and `headersTimeout` are the key Slowloris defences: a client that trickles bytes forever is disconnected instead of holding a request handler and a DB connection pool slot.

---

## Architecture / Flow

```text
Attack sources (botnet)
        │
        ▼
  CDN / Anycast scrubbing  ← absorbs volumetric floods (bandwidth)
        │
        ▼
  WAF + bot detection      ← filters application-layer abuse (L7 signatures, rate anomalies)
        │
        ▼
  Load balancer            ← spreads load; SYN cookies terminate half-open connections
        │
        ▼
  API Gateway              ← rate limiting, authN/authZ (see rate-limiting.md)
        │
        ▼
  App servers (Node.js)    ← request/header timeouts, connection limits, body limits
        │
        ▼
  Database / cache         ← connection pooling + caching absorb legitimate load
```

The key idea: **absorb as far from the origin as possible.** Blocking bandwidth floods at the CDN means the request never reaches your servers at all.

---

## How it Works

1. **Absorb volumetric floods at the edge** — a CDN or anycast network spreads the flood across many points of presence and scrubs it before it reaches the origin.
2. **Filter application-layer abuse at the WAF** — signature and rate-anomaly rules plus bot detection block HTTP floods and known attack patterns.
3. **Terminate protocol exhaustion at the load balancer** — SYN cookies and connection limits stop half-open connections from filling server state.
4. **Rate limit at the gateway** — per-IP or per-key token bucket returns `429` and throttles a single abusive client (see [Rate Limiting](rate-limiting.md)).
5. **Enforce timeouts at the app** — `requestTimeout` and `headersTimeout` kill Slowloris-style slow requests that would otherwise hold handlers and connection slots.
6. **Cap payloads and connections** — body size limits and `maxConnections` prevent a flood from exhausting memory or sockets.
7. **Scale and cache for legitimate load** — autoscaling plus [Caching Strategies](caching-strategies.md) and [Connection Pooling](connection-pooling.md) keep genuine traffic served even under a large-but-legitimate spike.
8. **Monitor and respond** — request rate, error rate, and latency metrics (see [Distributed Tracing](distributed-tracing.md)) detect an attack early so rules can be tightened automatically.

---

## Advantages

- **Availability for real users** — the core goal: legitimate traffic keeps flowing during an attack
- **Layered defence** — each layer blocks a different attack class, so no single control is a single point of failure
- **Cheap at the app layer** — timeouts, body limits, and connection caps are near-zero-cost to implement
- **Reuses existing patterns** — rate limiting, caching, circuit breakers, and bulkheads are already resilience primitives
- **Absorbs accidental spikes too** — the same controls protect against flash crowds and buggy clients, not just attackers

---

## Trade-offs

| Concern | Risk | Mitigation |
|---------|------|------------|
| **Cost** | CDN/WAF scrubbing and anycast are paid services | Start with app-level controls; add edge protection as the attack surface grows |
| **False positives** | Aggressive WAF/rate limits block legitimate users | Tune thresholds; allowlist trusted partners; challenge (CAPTCHA) rather than hard-block |
| **L7 attacks look like real traffic** | Application-layer floods are hard to distinguish from legitimate spikes | Behavioural bot detection, per-user rate limits, anomaly baselines |
| **Source spoofing** | Attackers rotate IPs and spoof source addresses | Rate limit by identity/token, not just IP; rely on edge, not origin, for IP filtering |
| **Latency** | Every layer adds a hop and processing time | Keep app-level checks O(1) in memory; offload heavy filtering to the edge |

---

## When to Use

- **Any public-facing service** — websites, APIs, and apps reachable from the internet
- **High-value targets** — e-commerce, gaming, financial services, or anything where downtime is costly
- **Services with expensive endpoints** — report generation, bulk exports, AI inference that a flood can saturate
- **Flash-sale or launch moments** — when traffic spikes are expected but abuse is likely
- **Compliance / SLA requirements** — availability guarantees often require documented DoS protection

---

## When NOT to Use

- **Internal-only services on a trusted network** — the threat model is different; basic rate limiting and timeouts may suffice
- **A single low-risk API with no availability SLA** — a simple rate limiter (see [Rate Limiting](rate-limiting.md)) is more cost-effective than a full CDN/WAF stack
- **When the traffic pattern is fully predictable** — coordinated with trusted, rate-controlled clients, the edge overhead may be unnecessary

---

## Related Concepts

- [Rate Limiting](rate-limiting.md) — the application-layer primitive for throttling a single abusive client
- [API Security (OWASP Top 10)](owasp-top-10.md) — DoS protection complements the OWASP risks; availability is part of the CIA triad
- [Circuit Breaker](circuit-breaker.md) — stops a flooded downstream service from cascading failure back to callers
- [Bulkhead Pattern](bulkhead-pattern.md) — isolates pools so one exhausted dependency does not take down the whole service
- [Backpressure](backpressure.md) — flow control that keeps producers from overwhelming consumers under load
- [Caching Strategies](caching-strategies.md) — serves cached responses, absorbing load without hitting the origin
- [Connection Pooling](connection-pooling.md) — prevents a flood from exhausting database connections
- [Graceful Shutdown](graceful-shutdown.md) — drain connections cleanly when a node is overwhelmed and removed
- [Distributed Tracing](distributed-tracing.md) — observability to detect and investigate an attack
- CDN
- WAF
- Anycast
- SYN flood
- Slowloris
- AWS Shield
- Cloudflare

---

## Key Takeaways

> DDoS attacks come in three classes — volumetric (bandwidth), protocol (connection state), and application-layer (request/CPU) — and each needs a different defence, so protection is layered, never a single control. Absorb attacks as far from the origin as possible: CDN/anycast for volumetric floods, WAF for L7 abuse, load balancers for protocol exhaustion. At the application layer, use rate limiting, `requestTimeout`/`headersTimeout` to defeat Slowloris, and body/connection caps to prevent resource exhaustion. Remember the goal is availability for legitimate users — so tune thresholds to avoid false positives, rate limit by identity not just IP, and monitor traffic to detect and respond early. These same controls also absorb legitimate flash-crowd spikes, so DoS protection doubles as peak-load resilience.
