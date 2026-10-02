# Load Balancing

> Distributing requests across a pool of interchangeable backends by repeatedly answering two questions: which instance should get this request, and can it still be trusted to serve it.

---

## What is it?

A load balancer is a proxy that sits between clients and a pool of backend instances. Its entire job is two decisions per request:

1. **Selection** — which instance gets this request (round robin, least connections, hashing, weighted).
2. **Trust** — is that instance healthy enough to receive it right now (active probes, passive observation, draining).

Everything else a load balancer does — TLS termination, retrying on a different backend, connection reuse, slow start, rate limiting — is a refinement of those two decisions.

---

## Problem

A single server instance is both a capacity ceiling and a single point of failure:

- **Finite headroom** — vertical scaling stops helping long before the traffic stops growing.
- **Hardcoded addresses break constantly** — instances are replaced on every deploy, every autoscaling event, and every crash. A client with a fixed IP talks to a dead process.
- **Instances are not interchangeable** — a `2xl` box with more CPU and a bigger pool gets exactly the same share of traffic as a `small` box, so the fast instance sits idle while the slow one queues.
- **Deploys need a handover** — an instance being replaced must stop receiving new requests while its in-flight requests finish, otherwise users see connection resets.
- **Failure is invisible until it is measured** — a backend that is failing every request stays in rotation because nothing probed it.
- **Traffic needs absorbing somewhere** — spikes, misbehaving clients, and floods should be soaked up before they reach the origin.

Without a load balancer, every client must solve discovery, health checking, and distribution itself — which is exactly what [Service Discovery](service-discovery.md) does in the client-side model.

---

## Example

### Selection, Worked Through

Three backends, arriving requests one at a time:

```text
Backend A (weight 1)   B (weight 2)   C (weight 1)   — heterogeneous capacity

Round robin:            A, B, C, A, B, C         → C gets as much as A despite half the capacity
Weighted round robin:   B, B, A, C, B, B         → share matches capacity
Least connections:      all get one each, then
                        whichever still has a free slot first
Least response time:    whichever has the lowest
                        EWMA latency × current load — adapts to slow backends
IP hash / consistent:   hash(clientId) → A        → same client always reaches A
```

### Node.js Implementation

An in-process load balancer that selects, retries, and tracks health. In production this logic lives in the ingress controller or the load balancer itself — the point is to make the behaviour explicit.

```typescript
interface Backend {
  id: string;
  weight: number;
  inFlight: number;
  currentWeight: number;
  ewmaLatencyMs: number;
  consecutiveFailures: number;
  healthy: boolean;
  draining: boolean;
}

type Strategy =
  | 'round-robin'
  | 'weighted-round-robin'
  | 'least-connections'
  | 'least-response-time'
  | 'power-of-two';

const EWMA_ALPHA = 0.1; // how fast latency history is forgotten
const FAILURE_THRESHOLD = 3; // passive health check: eject after 3 bad requests

class LoadBalancer {
  private backends: Backend[] = [];
  private cursor = 0;

  constructor(private readonly strategy: Strategy = 'least-connections') {}

  addBackend(id: string, weight = 1): void {
    this.backends.push({
      id,
      weight,
      inFlight: 0,
      currentWeight: 0,
      ewmaLatencyMs: 0,
      consecutiveFailures: 0,
      healthy: true,
      draining: false,
    });
  }

  // Health check and draining both remove a backend from rotation for new requests
  private candidates(exclude: Set<string>): Backend[] {
    return this.backends.filter(
      (b) => b.healthy && !b.draining && !exclude.has(b.id)
    );
  }

  select(exclude = new Set<string>()): Backend {
    const pool = this.candidates(exclude);
    if (pool.length === 0) throw new Error('No healthy backends available');

    switch (this.strategy) {
      case 'round-robin': {
        const backend = pool[this.cursor % pool.length]!;
        this.cursor += 1;
        return backend;
      }
      case 'weighted-round-robin':
        return this.smoothWeightedPick(pool);
      case 'least-connections':
        return pool.reduce((a, b) =>
          a.inFlight / a.weight <= b.inFlight / b.weight ? a : b
        );
      case 'least-response-time':
        return pool.reduce((a, b) => (this.loadAdjusted(b) <= this.loadAdjusted(a) ? b : a));
      case 'power-of-two': {
        // Two random samples beat scanning the whole pool (power of two choices)
        const pick = () => pool[Math.floor(Math.random() * pool.length)]!;
        const a = pick();
        const b = pick();
        return this.loadAdjusted(a) <= this.loadAdjusted(b) ? a : b;
      }
    }
  }

  // Smooth weighted round robin: hand out credit, take the richest node, subtract the total
  private smoothWeightedPick(pool: Backend[]): Backend {
    let best = pool[0]!;
    for (const backend of pool) {
      backend.currentWeight += backend.weight;
      if (backend.currentWeight > best.currentWeight) best = backend;
    }
    best.currentWeight -= pool.reduce((sum, b) => sum + b.weight, 0);
    return best;
  }

  private loadAdjusted(b: Backend): number {
    return (b.ewmaLatencyMs || 1) * (b.inFlight + 1) / b.weight;
  }

  async dispatch<T>(
    send: (backendId: string) => Promise<T>,
    retries = 0
  ): Promise<T> {
    const attempted = new Set<string>();
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      let backend: Backend;
      try {
        backend = this.select(attempted);
      } catch {
        break; // every eligible backend already tried — stop retrying
      }
      attempted.add(backend.id);
      backend.inFlight++;
      const startedAt = performance.now();

      try {
        const result = await send(backend.id);
        this.recordSuccess(backend, performance.now() - startedAt);
        return result;
      } catch (err) {
        this.recordFailure(backend, performance.now() - startedAt);
        lastError = err;
      } finally {
        backend.inFlight--;
      }
    }

    throw lastError;
  }

  private recordSuccess(backend: Backend, latencyMs: number): void {
    backend.consecutiveFailures = 0;
    backend.ewmaLatencyMs =
      backend.ewmaLatencyMs === 0
        ? latencyMs
        : (1 - EWMA_ALPHA) * backend.ewmaLatencyMs + EWMA_ALPHA * latencyMs;
  }

  private recordFailure(backend: Backend, latencyMs: number): void {
    backend.ewmaLatencyMs =
      backend.ewmaLatencyMs === 0
        ? latencyMs
        : (1 - EWMA_ALPHA) * backend.ewmaLatencyMs + EWMA_ALPHA * latencyMs;
    backend.consecutiveFailures++;
    if (backend.consecutiveFailures >= FAILURE_THRESHOLD) {
      backend.healthy = false; // passive health check ejected it from rotation
    }
  }

  // Stop sending new requests; existing requests keep their backend until they finish
  drain(id: string): void {
    const backend = this.backends.find((b) => b.id === id);
    if (backend) backend.draining = true;
  }

  // Active health check — called on a timer, independent of traffic
  async checkHealth(probe: (backendId: string) => Promise<void>): Promise<void> {
    await Promise.all(
      this.backends.map(async (backend) => {
        try {
          await probe(backend.id);
          backend.healthy = true;
        } catch {
          backend.healthy = false;
        }
      })
    );
  }
}

// Usage
const lb = new LoadBalancer('least-response-time');
lb.addBackend('order-1', 2);
lb.addBackend('order-2', 1);
lb.addBackend('order-3', 1);

const order = await lb.dispatch(async (backendId) => {
  const response = await fetch(`http://${backendId}:3000/internal/orders/42`);
  if (!response.ok) throw new Error(`Backend ${backendId} failed`);
  return response.json();
}, 1); // one retry on a different backend
```

### Express Wiring

A real backend exposes readiness separately from liveness, and answers `503` while draining:

```typescript
import express from 'express';

const app = express();
let shuttingDown = false;
let inFlight = 0;

// Liveness — is the process itself broken?
app.get('/healthz', (_req, res) => {
  res.sendStatus(200);
});

// Readiness — should the load balancer send me traffic?
app.get('/readyz', (_req, res) => {
  if (shuttingDown) return res.status(503).json({ status: 'draining' });
  res.json({ status: 'ready', inFlight });
});

process.on('SIGTERM', () => {
  shuttingDown = true; // readiness fails → LB stops routing new requests
});

app.listen(3000);
```

---

## Architecture / Flow

```text
                        Client
                           │  DNS → VIP
                           ▼
              ┌────────────────────────────┐
              │      Load Balancer         │
              │                            │
              │  1. Rules      host/path   │  traffic belongs in this pool?
              │  2. Health     active +    │  is this backend eligible?
              │                passive     │
              │  3. Selection  algorithm   │  which eligible backend?
              │  4. Retry      budget      │  failed — try a different one?
              └────────────────────────────┘
                    │           │          │
                    ▼           ▼          ▼
               backend-1    backend-2   backend-3
               (healthy)    (healthy)   (draining —
                                             no new work)

Request lifecycle:
  new TCP connection ──► [ reusable? yes: reuse, no: handshake ]
                      ──► select backend ──► forward
                      ──► on 5xx/timeout: eject + retry (idempotent only)
                      ──► on 4xx: return as-is, do not retry
```

### Where It Runs

| Model | Component | Layer | Notes |
|-------|-----------|-------|-------|
| Cloud managed | AWS ALB / NLB, GCP forwarding rules | L7 / L4 | Integrated health checks, TLS, WAF |
| Ingress controller | NGINX, Envoy, Traefik, K8s Ingress | L7 | Routing rules live as config |
| Node-local | `kube-proxy` (iptables / IPVS / eBPF) | L4 | Every node programs rules for the ClusterIP |
| Service mesh | Envoy sidecar | L7 | Per-service retries, outlier detection, mTLS |
| In application | Round-robin pick over a registry | L7 | Client-side [discovery](service-discovery.md) |
| DNS | Weighted or ` failover records | DNS | Coarse, cached for seconds to minutes |

### Layer 4 vs Layer 7

| Aspect | L4 (TCP/UDP) | L7 (HTTP/gRPC) |
|--------|---------------|----------------|
| Sees | Source/destination IP and port | Method, path, headers, cookies, body |
| Routing granularity | One pool per VIP/port | Per host, path, header, cookie |
| TLS | Passthrough, or terminated at the LB | Terminated at the LB, optionally re-encrypted to the origin |
| Throughput cost | Very high per Gbps, minimal CPU | CPU per request and per byte |
| Retry | Cannot retry once bytes are streamed | Can retry before the response is written |
| Stickiness | NAT by source IP | Cookie or header |
| Examples | `kube-proxy` IPVS, AWS NLB | AWS ALB, NGINX, Envoy, Traefik |

L7 buys routing granularity and observability at a CPU cost; L4 buys raw throughput and protocol transparency. Many stacks use both — L4 at the edge, L7 inside.

---

## How it Works

1. The client resolves a virtual IP (or DNS name) to a load balancer address, never to a backend directly.
2. The load balancer matches the request against routing rules — host, path, port, headers — to pick the correct backend pool.
3. Health state is applied: backends that failed the active probe, tripped the passive failure counter, or are draining are removed from the eligible set.
4. The selection algorithm chooses one eligible backend from what remains.
5. The load balancer reuses an existing backend connection if keep-alive is available, otherwise it opens one (plus a TLS handshake if terminating).
6. It forwards the request and streams the response back. Hop-by-hop headers are stripped; `X-Forwarded-For` and `X-Forwarded-Proto` are added.
7. On a connection error, timeout, or `5xx`, the backend is marked failed and the request is retried on a *different* backend — only if the request is idempotent.
8. On a `4xx`, the response is returned untouched; retrying would just repeat the client's mistake.
9. When a backend is terminating, it is marked draining — no new selections, in-flight requests finish, idle connections are closed.
10. A newly healthy backend does not immediately take full traffic: **slow start** ramps its share over seconds so a cold JIT, cache, or connection pool is not overwhelmed by a sudden burst.

### Selection Algorithms

| Algorithm | Chooses | Best for | Weakness |
|-----------|---------|----------|----------|
| Round robin | The next backend in the list | Uniform backends, even traffic | Ignores load, latency, and size |
| Weighted round robin | Next backend, weighted by capacity | Mixed instance types, canaries | Static weights drift as load changes |
| Least connections | Fewest in-flight requests | Uneven request durations (long polling, streaming) | Blind to per-request cost until connections pile up |
| Least response time | Lowest `latency × load`, latency as EWMA | Heterogeneous, auto-scaling fleets | Reacts to history, so a recovering backend stays sidelined |
| Least request rate / power of two | Best of two random samples | Very large fleets — O(1) instead of O(N) | Approximate; occasional imbalance |
| Random | Uniform random pick | Cheap, no shared state | Same blind spots as round robin |
| IP hash / consistent hash | `hash(clientId) % N` | Session affinity, cache locality | Hotspots on large NAT'd client ranges |
| Queue-based (LLQ) | Oldest waiting request | Fairness under overload | Requires a global queue — poor fit across regions |

Consistent hashing (`hash` over a ring instead of modulo) is the better form of affinity when backends join and leave — see [Consistent Hashing](consistent-hashing.md).

### Health Checking

| | Active | Passive |
|---|--------|---------|
| How | Periodic probe: HTTP `/healthz`, TCP connect, gRPC health | Watches real request outcomes: refusals, timeouts, `5xx` |
| Detection time | `interval × failure_threshold` | First failure, or `max_fails` within a window |
| Cost | Extra connections per backend per interval | Free — rides on existing traffic |
| Blind spot | Only tests what the probe exercises; a pod can pass `/healthz` and fail under real load | A dead-but-idle backend stays "healthy"; the LB never learns without traffic |
| Examples | AWS ALB target groups, Kubernetes readiness probes | NGINX `proxy_next_upstream`, Envoy outlier detection |

Both are needed: passive checks see real failures that a synthetic probe misses, active checks remove silent nodes. Use **hysteresis** — require more successes to re-admit than failures to remove — or a backend flaps in and out of rotation. Pair this with [Graceful Shutdown](graceful-shutdown.md) so readiness flips to failing before the process exits.

### Connection Lifecycle

- **Keep-alive and connection reuse** — amortises the TCP and TLS handshakes; requires the pool to be per-backend, so rebalancing means draining idle connections.
- **Draining** — a terminating backend is removed from selection but keeps serving in-flight requests until `inFlight === 0`, then connections close.
- **Retry budget** — retry only idempotent methods (`GET`, `PUT`, `DELETE`), cap attempts (1–2), and retry a *different* backend. Never retry a non-idempotent `POST` without an [Idempotency Key](idempotency.md).
- **Slow start** — ramp traffic into a recovering backend so it is not killed again by a cold start.
- **Outlier ejection** — temporarily remove a backend that is mostly failing even though it is nominally healthy.

---

## Advantages

- **Horizontal scale** — add instances without touching clients; capacity is linear rather than vertical.
- **No single point of failure in the app tier** — one instance crashing affects at most `1/N` of requests.
- **Zero-downtime deploys** — draining lets old and new versions coexist while sessions and connections finish.
- **Heterogeneous capacity** — weights match traffic to actual hardware, so a canary gets 1% and a `2xl` gets 50%.
- **Absorbs failure and abuse** — health checking, retry, and connection limits stop a bad instance or a bad client from taking down the tier.
- **One place for cross-cutting policy** — TLS termination, [rate limiting](rate-limiting.md), WAF rules, access logs, and [tracing](distributed-tracing.md) headers in one component.

---

## Trade-offs

- **Extra latency and a hop** — every request pays a network round trip and a proxy's processing.
- **The load balancer becomes critical** — it is now a single point of failure; it needs its own HA pair, and a bad config takes down the whole tier.
- **Opaque failures** — passive checks only see failures traffic happens to trigger; a backend idle for an hour can be dead and still look healthy.
- **Stickiness is a smell** — session affinity pushes state onto the balancer and breaks rebalancing; prefer stateless services and tokens.
- **Metrics get muddied** — per-instance metrics need the balancer's fields merged in, or every instance looks idle.
- **Retry amplification** — careless retries turn a small failure into a storm; budget them.
- **State limits scale** — per-connection tables and cache affinity do not shard across regions.
- **Config is code** — routing and health rules become a critical, reviewable artifact.

---

## When to Use

- **Multiple instances of a service** — the default answer for any horizontally scaled tier.
- **Rolling and canary deployments** — draining and weight changes make releases invisible to users ([Rollout Strategies](rollout-strategies.md)).
- **Mixed instance types** — weight the `2xl` higher than the `small`.
- **Uneven request costs** — least connections protects against a few slow long-held requests starving the rest.
- **Edge protection** — absorbing floods and TLS handshakes before they reach the origin ([DDoS Protection](ddos-protection.md)).
- **Stateless HTTP/gRPC services** — the ideal case, since any instance can serve any request.
- **Connection pooling** — distributing pooled connections avoids per-request setup ([Connection Pooling](connection-pooling.md)).

---

## When NOT to Use

- **A single instance** — one process and one database is simpler; nothing to balance.
- **Stateful servers** — if a session lives in one process's memory, stickiness turns the load balancer into a hard partitioner. Externalise state instead.
- **The client already does discovery** — in the client-side model of [Service Discovery](service-discovery.md), each caller picks an instance itself; a proxy adds a hop for nothing.
- **Inside a service mesh** — the sidecar already performs balancing, retries, and outlier detection; a second proxy duplicates the work.
- **Cross-region writes needing global load data** — a single-region balancer has stale information; let clients pick across regions and balance within a region.
- **Latency-critical sub-millisecond paths** — two extra network hops may cost more than the imbalance saves.

---

## Related Concepts

- [Service Discovery](service-discovery.md) — finding the instances in the first place; server-side discovery *is* a load balancer
- [Consistent Hashing](consistent-hashing.md) — key-based placement for affinity and cache distribution
- [Graceful Shutdown](graceful-shutdown.md) — draining is the load balancer's side of a clean shutdown
- [Rollout Strategies](rollout-strategies.md) — canary and blue/green depend on LB weights and health gating
- [Circuit Breaker](circuit-breaker.md) — client-side equivalent of ejecting a failing backend
- [Retry Pattern](retry-pattern.md) — load balancer retries must be budgeted and idempotent
- [Idempotency](idempotency.md) — makes retrying a failed `POST` safe
- [Connection Pooling](connection-pooling.md) — the LB pools connections per backend for the same reason
- [Rate Limiting](rate-limiting.md) — enforced at the edge, before traffic is distributed
- [DDoS & DoS Protection](ddos-protection.md) — the LB is a defence layer for protocol exhaustion
- [Distributed Tracing](distributed-tracing.md) — trace headers must survive the proxy hop
- [Replication](replication.md) — read replicas behind a load balancer scale reads

---

## Key Takeaways

> A load balancer makes two decisions per request: which backend gets it, and whether that backend is still trustworthy. Selection algorithms (round robin, weighted, least connections, least response time, hashing) trade statefulness against accuracy — none of them are correct in the abstract, the right one depends on whether instances are uniform and requests are uniform in cost. Health checking needs both active probes (removes silent nodes) and passive observation (catches failures a probe cannot reproduce), with hysteresis to prevent flapping. The operational behaviour that matters most is not selection but lifecycle: draining during [Graceful Shutdown](graceful-shutdown.md), slow start for recovering backends, and strictly budgeted retries on a different backend. Remember the load balancer is itself a critical dependency — it needs redundancy, and its routing rules are production code.
