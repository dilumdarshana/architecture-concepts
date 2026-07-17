# Service Discovery

> The mechanism by which services in a distributed system automatically find each other\'s network locations.

---

## What is it?

Service discovery solves the problem of locating a service's network address (IP and port) when instances are dynamically created and destroyed. Instead of hardcoding URLs, a service queries a **service registry** (or uses DNS) to find healthy instances of the target service. The two main approaches are **client-side discovery** (the client queries the registry directly) and **server-side discovery** (a load balancer or proxy queries the registry on the client's behalf).

---

## Problem

In a distributed system, services are not static:

- Instances are created and terminated by autoscaling.
- Containers are rescheduled onto different hosts by Kubernetes.
- Rolling deployments replace old instances with new ones on different IPs.
- A failed instance must be removed from the routing table.

Hardcoded IPs break on every deployment. Environment variables help but do not scale to hundreds of ephemeral instances. A central, up-to-date registry of healthy instances is required so that clients always connect to a working instance.

---

## Example

### Client-Side Discovery with Consul

The client queries the registry directly and picks an instance:

```typescript
import * as consul from 'consul';

const client = new consul.Consul();

async function getPaymentServiceUrl(): Promise<string> {
  const services = await client.agent.service.list();
  const paymentInstances = Object.values(services)
    .filter((s) => s.Service === 'payment-service')
    .filter((s) => s.Status === 'passing'); // health check passed

  if (paymentInstances.length === 0) throw new Error('No healthy payment instances');

  // Pick one (round-robin or random)
  const instance = paymentInstances[Math.floor(Math.random() * paymentInstances.length)];
  return `http://${instance.Address}:${instance.Port}`;
}

async function chargePayment(orderId: string) {
  const url = await getPaymentServiceUrl();
  const response = await fetch(`${url}/charge`, {
    method: 'POST',
    body: JSON.stringify({ orderId }),
    headers: { 'Content-Type': 'application/json' }
  });
  return response.json();
}
```

### Server-Side Discovery with Kubernetes

Kubernetes provides built-in service discovery via DNS and the `kube-proxy`:

```typescript
// Service name resolves to available endpoints
// No explicit discovery logic needed in the client
const response = await fetch('http://payment-service.default.svc.cluster.local:3000/charge', {
  method: 'POST',
  body: JSON.stringify({ orderId }),
  headers: { 'Content-Type': 'application/json' }
});

// Kubernetes DNS round-robins across healthy pod IPs
// kube-proxy forwards traffic to available pods
// Failed pods are removed from the endpoint list by readiness probes
```

### Service Registration (Sidecar Pattern)

Services register themselves on startup via a sidecar agent:

```typescript
// registration.js — runs as a sidecar or init container
import * as consul from 'consul';

const client = new consul.Consul();
const serviceId = `payment-service-${process.env.HOSTNAME}`;

async function register() {
  await client.agent.service.register({
    id: serviceId,
    name: 'payment-service',
    address: process.env.POD_IP,
    port: parseInt(process.env.PORT || '3000'),
    check: {
      http: `http://${process.env.POD_IP}:${process.env.PORT || '3000'}/health`,
      interval: '10s',
      timeout: '5s'
    }
  });
}

async function deregister() {
  await client.agent.service.deregister(serviceId);
}

process.on('SIGTERM', async () => {
  await deregister();
  process.exit(0);
});

register();
```

---

## Architecture / Flow

### Client-Side Discovery

```text
                    ┌──────────────┐
                    │  Service     │
                    │  Registry    │
                    │ (Consul /    │
                    │  etcd)       │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │ query      │            │
         ┌────▼─────┐     │            │
         │  Client   │     │            │
         │  Service  │     │            │
         └────┬─────┘     │            │
              │           │            │
              │ direct    │            │
              │ request   │            │
              ▼           ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Instance │ │ Instance │ │ Instance │
        │ 1        │ │ 2        │ │ 3        │
        └──────────┘ └──────────┘ └──────────┘
```

### Server-Side Discovery (Kubernetes)

```text
                    ┌──────────────┐
                    │   etcd /     │
                    │  API Server  │
                    └──────┬───────┘
                           │ watch
                    ┌──────▼───────┐
                    │ kube-proxy   │
                    │ (per node)   │
                    └──────┬───────┘
                           │
  Client ─────► DNS ─────► Service IP ────► kube-proxy ────► Pod
               (payment-                   (load balances     1 of N
                service)                    across pods)       healthy
```

---

## How it Works

### Client-Side Discovery

1. Each service instance registers itself with the service registry on startup, providing its address, port, and health check endpoint.
2. The registry runs health checks periodically, removing instances that fail.
3. When a client needs to call a downstream service, it queries the registry for healthy instances.
4. The client picks one instance (round-robin, random, least-loaded).
5. If the request fails, the client retries with a different instance from the registry.
6. On shutdown, the instance deregisters itself from the registry.

### Server-Side Discovery (Kubernetes DNS)

1. Each pod registers its IP with the Kubernetes API server via the pod lifecycle.
2. A Service object defines a logical set of pods by label selector.
3. The Kubernetes DNS resolves the service name to a virtual IP (ClusterIP).
4. kube-proxy on each node watches the API server and programs iptables/IPVS rules to forward traffic from the ClusterIP to healthy pods.
5. The client sends requests to the service name — routing is handled transparently.

---

## Advantages

- **Dynamic routing** — clients always find healthy instances without configuration changes
- **Loose coupling** — clients depend on a service name, not a specific instance
- **Self-healing** — failed instances are automatically removed from the registry
- **Load distribution** — client-side discovery can implement custom load balancing strategies
- **Blueprint for deployments** — rolling updates, blue-green, and canary deployments are feasible because traffic is routed only to healthy instances

---

## Trade-offs

- **Infrastructure dependency** — the registry itself must be highly available (etcd, Consul — see [Consensus Algorithms](consensus-algorithms.md))
- **Client complexity** — client-side discovery adds service-resolution logic to every client
- **Staleness** — registry state may lag behind reality; clients may attempt requests to recently-terminated instances
- **Observability** — distributed tracing must propagate the specific instance address to correlate logs (see [Distributed Tracing](distributed-tracing.md))
- **Security** — the registry is a sensitive component; access must be authenticated and encrypted

---

## When to Use

- **Containerised deployments** — Kubernetes, Nomad, or Docker Swarm where IPs change frequently
- **Autoscaling services** — instances are created and destroyed dynamically based on load
- **Microservices with many instances** — more than a handful of service copies
- **Multi-region deployments** — clients should discover the nearest healthy instance
- **Blue-green or canary deployments** — traffic must be routed to the correct version

---

## When NOT to Use

- **Monolithic or few-service deployments** — static DNS entries or environment variables are simpler
- **Fixed infrastructure** — if instances are long-lived and rarely change, hardcoding addresses works
- **Small teams** — the operational overhead of running Consul/etcd may not be justified
- **Load balancer already present** — if all services are behind an API gateway or load balancer, you already have server-side discovery

---

## Related Concepts

- [Consensus Algorithms](consensus-algorithms.md) — service registries (etcd, Consul) use Raft for consistency
- [Distributed Systems](distributed-systems.md) — discovery is a core primitive in distributed architectures
- [Distributed Tracing](distributed-tracing.md) — tracing requires propagating instance identifiers
- [Circuit Breaker](circuit-breaker.md) — the client should wrap service discovery calls with a circuit breaker
- [Graceful Shutdown](graceful-shutdown.md) — instances should deregister before shutting down
- [Health Checks](health-check-pattern.md) — liveness and readiness probes determine if an instance is discoverable
- Kubernetes DNS
- Consul
- etcd
- ZooKeeper
- Eureka (Netflix)

---

## Key Takeaways

> Service discovery enables clients to find healthy instances of a downstream service without hardcoded addresses. Client-side discovery (Consul, etcd) gives clients direct control over load balancing but adds client complexity. Server-side discovery (Kubernetes DNS + kube-proxy) is transparent to the client and simplifies the deployment model at the cost of infrastructure overhead. The service registry must be highly available — most use Raft-based consensus (etcd, Consul). Pair service discovery with health checks, graceful deregistration on shutdown, and circuit breakers on discovery calls for a robust system.
