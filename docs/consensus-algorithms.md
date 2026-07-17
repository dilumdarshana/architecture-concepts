# Consensus Algorithms

> A protocol that enables multiple nodes in a distributed system to agree on a single value despite failures.

---

## What is it?

A consensus algorithm allows a group of distributed nodes to agree on a single value (or sequence of values) even when some nodes fail or the network is unreliable. Consensus is the foundation for leader election, distributed coordination, replicated state machines, and strongly consistent replication. **Raft** and **Paxos** are the most widely deployed consensus algorithms; Raft is preferred for its understandability and simpler implementation.

---

## Problem

In a distributed system, nodes must sometimes agree on a single fact: who is the leader, what is the next log entry, or whether a transaction committed. Without consensus:

- Multiple nodes may believe they are the leader (split-brain).
- Replicas diverge permanently with no mechanism to reconcile.
- Clients receive inconsistent answers from different nodes.

Network partitions, message delays, and node crashes make agreement fundamentally hard — the **FLP impossibility result** proves that no deterministic algorithm can guarantee consensus in an asynchronous system with even one faulty node. Consensus algorithms work by bounding the problem (timeouts, leader-based coordination) to achieve safety and liveness under practical assumptions.

---

## Example

### Raft — Leader Election and Log Replication

A Raft cluster (typically 3 or 5 nodes) elects a leader. All writes go through the leader, which replicates them to followers.

```text
Client ──► Leader ──► Follower
                 └──► Follower
                 └──► Follower

1. Client sends write to Leader.
2. Leader appends to its log, sends AppendEntries to Followers.
3. Majority of Followers acknowledge.
4. Leader commits and responds to Client.
5. Leader notifies Followers of commit.
```

### Node.js: Simulating Raft Election

```typescript
interface LogEntry {
  term: number;
  command: string;
}

class RaftNode {
  state: 'follower' | 'candidate' | 'leader' = 'follower';
  currentTerm = 0;
  votedFor: string | null = null;
  log: LogEntry[] = [];
  commitLength = 0;
  electionTimeout: NodeJS.Timeout | null = null;

  constructor(public id: string, public peers: string[]) {
    this.resetElectionTimeout();
  }

  resetElectionTimeout() {
    if (this.electionTimeout) clearTimeout(this.electionTimeout);
    // Random timeout between 150-300ms
    const timeout = 150 + Math.random() * 150;
    this.electionTimeout = setTimeout(() => this.startElection(), timeout);
  }

  startElection() {
    this.state = 'candidate';
    this.currentTerm++;
    this.votedFor = this.id;
    let votes = 1; // vote for self

    // Request votes from peers (simplified)
    for (const peer of this.peers) {
      const granted = requestVote(peer, this.currentTerm, this.id);
      if (granted) votes++;
    }

    const majority = Math.floor(this.peers.length / 2) + 1;
    if (votes >= majority) {
      this.state = 'leader';
      this.becomeLeader();
    } else {
      this.state = 'follower';
      this.resetElectionTimeout();
    }
  }

  becomeLeader() {
    // Send heartbeats to maintain authority
    setInterval(() => {
      for (const peer of this.peers) {
        appendEntries(peer, this.currentTerm, this.id);
      }
    }, 50); // heartbeat interval
  }
}
```

Wait, that's pseudo-code. A production Node.js example using a real Raft library:

```typescript
import { RaftNode, RaftPeer } from '@earlgrey/raft'; // example library

const peer1: RaftPeer = { id: 'node-1', host: 'localhost:3001' };
const peer2: RaftPeer = { id: 'node-2', host: 'localhost:3002' };
const peer3: RaftPeer = { id: 'node-3', host: 'localhost:3003' };

const node = new RaftNode({
  id: 'node-1',
  peers: [peer2, peer3],
  storage: new FileSystemStorage('./raft-log'),
});

node.on('leader-change', (leaderId) => {
  console.log(`Leader is now: ${leaderId}`);
});

// Only the leader accepts writes
node.on('command', async (cmd: string) => {
  const result = await node.propose(cmd);
  console.log(`Committed: ${cmd} at index ${result.index}`);
});
```

---

## Architecture / Flow

### Raft Sub-problems

Raft decomposes consensus into three sub-problems:

```text
              ┌─────────────────┐
              │     Raft        │
              ├─────────────────┤
              │  Leader         │  One leader elected per term
              │  Election       │  Handles leader crashes
              ├─────────────────┤
              │  Log            │  Leader replicates commands
              │  Replication    │  Majority commits
              ├─────────────────┤
              │  Safety         │  Leader completeness,
              │                 │  state machine safety
              └─────────────────┘
```

### Raft Terms and Election

```text
Term 1               Term 2              Term 3
┌──────────┐   ┌──────────┐   ┌──────────────────┐
│ Leader A │   │ No Leader│   │    Leader B       │
└──────────┘   │ (split)  │   └──────────────────┘
               └──────────┘
     │               │               │
     └───────┬───────┘               │
             │                       │
        Election                  Election
        timeout                   timeout
```

---

## How it Works (Raft)

1. Each node starts as a **follower** and sets a random election timeout (150-300ms).
2. If a follower receives no heartbeat from the leader before its timeout, it becomes a **candidate** and starts an election.
3. The candidate increments its term, votes for itself, and sends `RequestVote` RPCs to all other nodes.
4. Other nodes vote for the candidate if they have not voted in this term and the candidate's log is at least as up-to-date.
5. If the candidate receives votes from a majority, it becomes the **leader**.
6. The leader sends periodic heartbeats (`AppendEntries` RPCs with no log entries) to maintain authority.
7. All write requests go to the leader. The leader appends the command to its log and sends `AppendEntries` to all followers.
8. When a majority of followers acknowledge, the leader commits the entry and applies it to its state machine.
9. The leader notifies followers of the commit index on the next heartbeat.
10. If a follower crashes and recovers, the leader replays missing log entries.

---

## Advantages

- **Strong consistency** — all non-faulty nodes agree on the same value, same order
- **Fault tolerance** — majority of nodes must be alive; handles minority failures
- **Safe leader changes** — at most one leader per term; no split-brain
- **Understandable** — Raft is designed for teachability and has a reference implementation
- **Proven** — used in etcd, Consul, MongoDB (raft-based), TiDB, and many others

---

## Trade-offs

- **Majority requirement** — a cluster of 2n+1 nodes tolerates only n failures; 3 nodes tolerate 1 failure
- **Performance bottleneck** — all writes go through the leader; read scalability requires read-only replicas
- **Latency** — each write requires a round trip to a majority of nodes
- **Complexity** — while simpler than Paxos, Raft is still non-trivial to implement correctly
- **Not for geo-distribution** — consensus across data centres adds significant latency; consider alternative approaches

---

## When to Use

- **Leader election** — ensuring only one node acts as primary at a time
- **Distributed configuration** — etcd and Consul use Raft for cluster-wide config
- **Replicated state machines** — every replica processes the same commands in the same order
- **Strongly consistent key-value stores** — single-key linearizability
- **Coordination services** — distributed locks, service discovery (ZooKeeper uses Zab, similar to Raft)

---

## When NOT to Use

- **Eventually consistent systems** — consensus overhead is unnecessary; gossip or CRDTs suffice
- **Geo-distributed clusters with high write volume** — leader-based consensus crosses data centres slowly
- **Systems that must survive network partitions with full availability** — CP system (see [CAP Theorem](cap-theorem.md))
- **Small, single-node deployments** — consensus adds complexity for no benefit

---

## Related Concepts

- [CAP Theorem](cap-theorem.md) — consensus algorithms are CP systems (sacrifice availability during partitions)
- [Distributed Lock](distributed-lock.md) — consensus is one way to implement distributed locks
- [Leader Election](leader-election.md) — consensus provides safe leader election
- [Consistency Models](consistency-models.md) — consensus enables linearizable consistency
- [Distributed Systems](distributed-systems.md) — consensus is a core distributed systems primitive
- Paxos
- Zab (ZooKeeper Atomic Broadcast)
- Raft
- FLP Impossibility

---

## Key Takeaways

> Consensus algorithms enable multiple nodes to agree on a single value despite failures. Raft is the most widely used consensus algorithm in modern infrastructure (etcd, Consul) — it decomposes consensus into leader election, log replication, and safety. Consensus provides strong consistency and fault tolerance but requires a majority to make progress and adds latency to every write. It is the foundation for distributed coordination, leader election, and replicated state machines.
