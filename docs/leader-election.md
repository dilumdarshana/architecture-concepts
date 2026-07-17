# Leader Election

> A process by which distributed nodes select one member to act as the coordinator for a period of time.

---

## What is it?

Leader election is the mechanism by which a group of distributed nodes agrees on a single node to act as the leader. The leader is responsible for coordinating writes, managing the replication log, assigning work, or representing the group externally. When the leader fails, the remaining nodes detect the failure and elect a new one. Leader election is a sub-problem of consensus but can also be implemented with simpler approaches when full consensus is not required.

---

## Problem

In a distributed system, many tasks require a single coordinator:

- Only one node should process the hourly batch job to avoid duplicate work.
- Only one node should accept write operations to a replicated data store.
- Only one node should renew the lease on an external resource.
- Only one node should represent the cluster to the outside world.

Without leader election, multiple nodes may simultaneously believe they are the coordinator — a **split-brain** scenario — leading to conflicting writes, duplicate processing, and corrupted state.

---

## Example

### Leader Election with Redis

A simple lease-based election using Redis `SET NX` with TTL:

```typescript
import { createClient } from 'redis';

const redis = createClient();

class RedisLeaderElection {
  private readonly leaderKey = 'leader:my-service';
  private readonly ttlMs = 10_000; // 10 second lease
  private isLeader = false;
  private renewInterval: NodeJS.Timeout | null = null;

  async tryBecomeLeader(instanceId: string): Promise<boolean> {
    // SET NX succeeds only if key does not exist
    const acquired = await redis.set(this.leaderKey, instanceId, {
      NX: true,
      PX: this.ttlMs,
    });

    if (acquired === 'OK') {
      this.isLeader = true;
      this.startRenewal(instanceId);
      return true;
    }

    // Check if current leader expired
    const currentLeader = await redis.get(this.leaderKey);
    if (!currentLeader) {
      // Race: another instance may have grabbed it
      return this.tryBecomeLeader(instanceId);
    }

    this.isLeader = false;
    return false;
  }

  private startRenewal(instanceId: string) {
    this.renewInterval = setInterval(async () => {
      // Renew the lease if we are still the leader
      const current = await redis.get(this.leaderKey);
      if (current === instanceId) {
        await redis.pexpire(this.leaderKey, this.ttlMs);
      } else {
        this.isLeader = false;
        this.stopRenewal();
      }
    }, this.ttlMs / 2); // renew at half TTL
  }

  async stepDown() {
    this.isLeader = false;
    this.stopRenewal();
    const current = await redis.get(this.leaderKey);
    if (current === this.instanceId) {
      await redis.del(this.leaderKey);
    }
  }

  private stopRenewal() {
    if (this.renewInterval) {
      clearInterval(this.renewInterval);
      this.renewInterval = null;
    }
  }

  getIsLeader(): boolean {
    return this.isLeader;
  }
}

// Usage
const election = new RedisLeaderElection();
const instanceId = `instance-${process.env.HOSTNAME}`;

async function start() {
  if (await election.tryBecomeLeader(instanceId)) {
    console.log('I am the leader');
    await runBatchJob();
  } else {
    console.log('I am a follower');
    await waitForWork();
  }
}

process.on('SIGTERM', async () => {
  await election.stepDown();
  process.exit(0);
});

start();
```

### Leader Election with etcd (Raft)

etcd provides a higher-level election API built on Raft consensus:

```typescript
import { Etcd3 } from 'etcd3';

const client = new Etcd3({ hosts: 'localhost:2379' });

async function electLeader() {
  const election = client.election('my-service');
  const instanceId = `instance-${process.env.HOSTNAME}`;

  // Campaign to become leader — blocks until elected
  await election.campaign(instanceId);
  console.log(`Elected leader: ${instanceId}`);

  // Starts a background lease; auto-steps down if disconnected
  // The leader stays leader until resign() is called
  // or the lease expires (loss of quorum)

  process.on('SIGTERM', async () => {
    await election.resign();
    process.exit(0);
  });

  return election;
}

// Other nodes can observe who the leader is
async function observeLeader() {
  const election = client.election('my-service');
  const observer = await election.observe();
  observer.on('change', (leader) => {
    console.log(`Leader changed to: ${leader}`);
  });
}
```

---

## Architecture / Flow

### Lease-Based Election (Redis)

```text
Instance A                  Redis                       Instance B
    │                         │                            │
    │  SET leader:A NX PX     │                            │
    │  10000                  │                            │
    │────────────────────────►│                            │
    │  OK (leader)            │                            │
    │◄────────────────────────│                            │
    │                         │                            │
    │                         │  SET leader:B NX PX 10000  │
    │                         │◄───────────────────────────│
    │                         │  (nil — key exists)        │
    │                         │───────────────────────────►│
    │                         │                            │
    │  (crashes)              │                            │
    │                         │  (TTL expires)             │
    │                         │                            │
    │                         │  SET leader:B NX PX 10000  │
    │                         │◄───────────────────────────│
    │                         │  OK (new leader)           │
    │                         │───────────────────────────►│
```

### Election with Consensus (Raft, etcd)

```text
Node A (Follower)         Node B (Candidate)          Node C (Follower)
     │                          │                          │
     │                    election timeout                 │
     │                          │                          │
     │                   term += 1                         │
     │                   vote for self                     │
     │                          │                          │
     │     RequestVote          │          RequestVote      │
     │◄─────────────────────────┤─────────────────────────►│
     │     grant vote           │          grant vote       │
     │──────────────────────────►◄──────────────────────────│
     │                          │                          │
     │                   majority (2/3)                    │
     │                   becomes leader                    │
     │                          │                          │
     │     AppendEntries        │          AppendEntries    │
     │     (heartbeat)          │          (heartbeat)      │
     │◄─────────────────────────┤─────────────────────────►│
```

---

## How it Works

### Lease-Based Election (Redis)

1. Each instance generates a unique identifier (e.g. `instance-<hostname>`).
2. On startup, each instance tries to acquire a lock key in Redis using `SET NX` with a TTL.
3. The instance that succeeds becomes the leader.
4. The leader periodically renews the lease (refreshes the TTL) to maintain leadership.
5. If the leader crashes, the TTL expires and the key is deleted automatically.
6. Another instance detects the missing key and acquires the lock.
7. On graceful shutdown, the leader explicitly deletes the key.

### Consensus-Based Election (Raft)

1. All nodes start as followers with a random election timeout (150-300ms).
2. When a follower receives no heartbeat within its timeout, it becomes a candidate.
3. The candidate increments its term, votes for itself, and broadcasts `RequestVote` to all peers.
4. A peer votes for the candidate if it has not voted in this term and the candidate's log is up-to-date.
5. If the candidate receives a majority of votes, it becomes the leader.
6. The leader broadcasts heartbeats to maintain authority and suppress new elections.
7. If the leader is partitioned from the majority, a new election occurs in the majority side.

---

## Advantages

- **Coordinated actions** — leader ensures only one node performs critical tasks (batch jobs, resource renewal)
- **Fault tolerance** — failure of the leader is detected and a new leader takes over automatically
- **Consistency** — consensus-based election guarantees at most one leader per term (no split-brain)
- **Simplicity** — lease-based election is easy to implement with any key-value store that supports TTL and compare-and-set
- **Resource efficiency** — non-leader nodes are passive; they consume minimal resources

---

## Trade-offs

| Approach | Trade-offs |
|----------|-----------|
| **Lease-based (Redis)** | Clock skew can cause multiple leaders if TTL is not synchronized; no guarantee of at-most-one leader; requires external Redis |
| **Consensus-based (Raft)** | Majority required; election delays during partitions; higher complexity and latency |
| **External (ZooKeeper, etcd)** | Dependence on an external cluster; adds operational overhead and latency to every leader action |

- **Split-brain risk** — lease-based approaches cannot guarantee a single leader under all failure scenarios
- **Election storm** — all followers may detect leader failure simultaneously, triggering a flood of elections (mitigated by random timeouts)
- **Thundering herd** — many instances competing for leadership in a short window
- **Graceful handover** — the old leader must step down before the new leader takes over to avoid overlapping windows

---

## When to Use

- **Batch job scheduling** — only one node should run hourly reports, data cleanup, or cache warming
- **Database failover** — promote a replica to primary when the current primary fails
- **Partition coordinator** — assign one node as the owner of a shard or partition
- **External resource management** — renewing TLS certificates, DNS zone updates, or cloud resource leases
- **Singleton services** — guarantee a single instance processes an event stream or message queue

---

## When NOT to Use

- **Stateless workloads** — if every instance can process independently, leadership adds unnecessary complexity
- **Idempotent operations** — if duplicate processing is safe (see [Idempotency](idempotency.md)), you do not need a leader
- **Systems that tolerate split-brain** — if conflicting operations are acceptable or can be reconciled, simpler approaches suffice
- **Small deployments** — a single instance with no failover requirement does not need election

---

## Related Concepts

- [Consensus Algorithms](consensus-algorithms.md) — Raft provides both leader election and log replication
- [Distributed Lock](distributed-lock.md) — leader election is a form of distributed lock (one instance acquires the "leader" lock)
- [Distributed Systems](distributed-systems.md) — leader election is a core distributed systems primitive
- [Circuit Breaker](circuit-breaker.md) — the leader should wrap election calls with circuit breakers to avoid cascading failures
- [Graceful Shutdown](graceful-shutdown.md) — the leader should step down gracefully during shutdown
- Split-brain
- ZooKeeper
- etcd
- Redis

---

## Key Takeaways

> Leader election ensures one node acts as coordinator for tasks that must be performed by exactly one instance. Lease-based election (Redis SET NX with TTL) is simple to implement but cannot fully guarantee at-most-one leader. Consensus-based election (Raft, etcd) provides stronger guarantees at the cost of complexity and latency. Always step down gracefully on shutdown and combine with lease renewal to handle crashes. For idempotent tasks, a leader is unnecessary — idempotency handles duplicates more simply.
