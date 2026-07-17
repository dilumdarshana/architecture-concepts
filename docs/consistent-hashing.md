# Consistent Hashing

> A hashing technique that minimises key remapping when the number of nodes in a distributed system changes.

---

## What is it?

Consistent Hashing maps keys to nodes in a way that only a small fraction of keys need to be reassigned when nodes are added or removed. Unlike traditional modulo-based hashing (`hash(key) % N`), which remaps nearly every key when N changes, consistent hashing assigns each key to the first node encountered while walking clockwise on a hash ring.

---

## Problem

In a distributed cache, database shard, or load-balanced service, data is partitioned across nodes using the key's hash. With simple modulo hashing:

```typescript
function getNode(key: string, nodeCount: number): number {
  return hash(key) % nodeCount; // almost all keys remap when nodeCount changes
}
```

When a node is added or removed, `N` changes, and `hash(key) % N` produces a different result for nearly every key. This causes a **cache stampede** — all data must be rebalanced, causing massive database load, cache misses, or data migration. Consistent hashing solves this by ensuring only `1/N` of keys move on average when a node changes.

---

## Example

### The Ring

```text
Traditional modulo (N=4 → N=3):
  Key A: hash % 4 = 2  →  hash % 3 = 0  (moved)
  Key B: hash % 4 = 1  →  hash % 3 = 1  (stayed)
  Key C: hash % 4 = 3  →  hash % 3 = 0  (moved)
  Key D: hash % 4 = 0  →  hash % 3 = 0  (stayed)
  → ~75% of keys moved

Consistent hashing (4 → 3 nodes):
  Only the keys assigned to the removed node are reassigned.
  → ~25% of keys move (1/N on average)
```

### Node.js Implementation

```typescript
import { createHash } from 'crypto';

class ConsistentHashRing {
  private ring: Map<number, string> = new Map(); // position → node
  private sortedPositions: number[] = [];
  private virtualNodes: number;

  constructor(nodes: string[], virtualNodes = 100) {
    this.virtualNodes = virtualNodes;
    for (const node of nodes) {
      this.addNode(node);
    }
  }

  private hash(key: string): number {
    const hash = createHash('md5').update(key).digest('hex');
    return parseInt(hash.substring(0, 8), 16);
  }

  addNode(node: string) {
    // Each real node gets multiple virtual nodes for better distribution
    for (let i = 0; i < this.virtualNodes; i++) {
      const position = this.hash(`${node}:${i}`);
      this.ring.set(position, node);
    }
    this.sortedPositions = Array.from(this.ring.keys()).sort((a, b) => a - b);
  }

  removeNode(node: string) {
    for (let i = 0; i < this.virtualNodes; i++) {
      const position = this.hash(`${node}:${i}`);
      this.ring.delete(position);
    }
    this.sortedPositions = Array.from(this.ring.keys()).sort((a, b) => a - b);
  }

  getNode(key: string): string {
    if (this.sortedPositions.length === 0) throw new Error('No nodes available');
    const hash = this.hash(key);

    // Binary search for the first position >= hash
    let lo = 0;
    let hi = this.sortedPositions.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (this.sortedPositions[mid] < hash) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    // Wrap around if no position is >= hash
    const position = this.sortedPositions[lo] ?? this.sortedPositions[0];
    const node = this.ring.get(position);
    if (!node) throw new Error('Node not found');
    return node;
  }
}

// Usage
const ring = new ConsistentHashRing(['cache-a', 'cache-b', 'cache-c']);
console.log(ring.getNode('user:123'));  // e.g. 'cache-b'
console.log(ring.getNode('order:456')); // e.g. 'cache-a'

// Add a node — only ~25% of keys move
ring.addNode('cache-d');
```

---

## Architecture / Flow

```text
                    Hash Ring
              ┌─────────────────┐
              │     Node C      │
              │   (position     │
              │    2900)        │
              │       │         │
     Node A   │       │         │   Node B
  (position   │       │         │  (position
   1000)      │       │         │   4200)
              │       │         │
              │     Node D      │
              │   (position     │
              │    5600)        │
              └─────────────────┘

Key "user:123" hashes to 3500:
  Walk clockwise → first node at position 4200 = Node B

When Node B is removed:
  Key "user:123" now maps to the next node clockwise = Node C
  Only keys assigned to Node B are affected
```

### Virtual Nodes

Without virtual nodes, real nodes may not distribute the hash space evenly. Virtual nodes solve this by mapping each real node to multiple positions on the ring:

```text
Real node A ──► virtual A:0 (pos 1000)
            ──► virtual A:1 (pos 3100)
            ──► virtual A:2 (pos 7200)

Real node B ──► virtual B:0 (pos 1500)
            ──► virtual B:1 (pos 4600)
            ──► virtual B:2 (pos 8300)
```

---

## How it Works

1. Each node is hashed to one or more positions on a circular hash ring (0 to 2^32-1).
2. Each key is hashed to a position on the same ring.
3. The key is assigned to the first node encountered by walking clockwise from the key's position.
4. If no node is found before completing the circle, the key wraps around to the first node.
5. When a node is added, only the keys in the arc between the new node and its clockwise neighbour are reassigned.
6. When a node is removed, only its keys are reassigned to the next clockwise node.
7. Virtual nodes improve distribution: each real node maps to multiple positions on the ring, smoothing out imbalances.

---

## Advantages

- **Minimal rehashing** — only 1/N of keys move when a node joins or leaves
- **Decentralised** — any node can independently determine where a key belongs without coordination
- **Scalable** — nodes can be added or removed incrementally without full rebalance
- **Load balancing** — virtual nodes spread keys evenly across real nodes
- **Hotspot mitigation** — popular keys are distributed; no single node becomes a bottleneck for a range

---

## Trade-offs

- **Uneven distribution with few nodes** — a small number of real nodes may leave some regions of the ring sparsely populated (mitigated with virtual nodes)
- **Virtual node overhead** — more metadata to store and manage; higher memory usage for the ring
- **Lookup complexity** — O(log N) for binary search vs O(1) for modulo; negligible for practical ring sizes
- **Not fully balanced** — adding/removing a node does not rebalance existing keys; hot nodes may need manual intervention
- **No range queries** — adjacent keys are distributed across nodes; range scans hit every node

---

## When to Use

- **Distributed caching** — Memcached, Redis Cluster, DynamoDB
- **Database sharding** — Cassandra, Riak, Voldemort use consistent hashing for data distribution
- **Load balancing** — distributing requests across backend servers based on request properties
- **CDN edge caches** — mapping content to edge nodes for cache affinity
- **Any system where nodes are added or removed frequently**

---

## When NOT to Use

- **Fixed cluster size** — if the node count never changes, simple modulo hashing is simpler and equally effective
- **Range-partitioned data** — if queries need to scan contiguous key ranges, range-based partitioning is better
- **Small clusters with predictable load** — modulo hashing with a fixed-size array is adequate
- **Systems requiring perfect balance** — consistent hashing is approximate; use a distributed hash table (DHT) with explicit rebalancing if tight balance is required

---

## Related Concepts

- [Sharding](sharding.md) — consistent hashing is a strategy for distributing shards across nodes
- [Distributed Systems](distributed-systems.md) — data partitioning is a fundamental distributed systems concern
- [CAP Theorem](cap-theorem.md) — consistent hashing is used in AP systems (Cassandra, DynamoDB)
- Hash Ring
- Virtual Nodes
- Rendezvous Hashing (HRW)
- DHT (Distributed Hash Table)

---

## Key Takeaways

> Consistent hashing maps keys to nodes on a circular hash ring, ensuring only 1/N of keys need to move when a node is added or removed. It is the foundation for distributed caches (Memcached, Redis Cluster) and databases (Cassandra, DynamoDB). Virtual nodes improve distribution quality, especially with small clusters. Consistent hashing is ideal for dynamic clusters where nodes change frequently but is unnecessary for fixed-sized deployments where simple modulo hashing suffices.
