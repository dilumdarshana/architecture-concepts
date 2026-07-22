# gRPC Concepts — TypeScript Demo

A hands-on demonstration of the four gRPC communication patterns using TypeScript:

- **Unary RPC** — single request, single response
- **Server Streaming RPC** — single request, stream of responses
- **Client Streaming RPC** — stream of requests, single response
- **Bidirectional Streaming RPC** — two-way stream of messages

## How gRPC Works at a Glance

```
┌─────────┐   Proto Definition   ┌─────────┐
│  Client │◄────────────────────►│  Server │
│  .ts    │   HTTP/2 + Protobuf  │  .ts    │
└─────────┘                      └─────────┘
```

1. You define the API in a `.proto` file (service + messages)
2. Both server and client load the same `.proto` file at runtime
3. Server implements the defined RPC methods
4. Client calls those methods — they look like local function calls

## Project Structure

```
grpc/
├── src/
│   ├── proto/
│   │   └── greeter.proto    # Service & message definitions (source of truth)
│   ├── server.ts            # gRPC server — implements all 4 RPC types
│   └── client.ts            # gRPC client — calls every RPC method
├── .nvmrc                   # Node.js version pinning
├── package.json
├── tsconfig.json
└── README.md
```

## Prerequisites

- Node.js (see `.nvmrc` for version)
- `pnpm` — install with `npm install -g pnpm`

## Quick Start

```bash
pnpm install

# Terminal 1 — start the server
pnpm run server

# Terminal 2 — run the client
pnpm run client
```

## The 4 RPC Types Explained

### 1. SayHello — Unary RPC

**Pattern**: Client sends one message → Server replies with one message.

```
Client                     Server
  │                          │
  │──── { name: "World" } ──►│
  │                          │
  │◄─── { message: "..." } ──┤
  │                          │
```

**Code flow** (`server.ts:18`):
```typescript
function sayHello(call, callback) {
  const reply = { message: `Hello ${call.request.name}!!!` };
  callback(null, reply);  // null = no error
}
```

The server receives a `HelloRequest` (with a `name` field) and responds with a `HelloReply` via the callback.

---

### 2. GetNumbers — Server Streaming RPC

**Pattern**: Client sends one request → Server pushes multiple responses over time.

```
Client                     Server
  │                          │
  │──{ count: 5 }───────────►│
  │                          │
  │◄──{ order:1, number:100 }─┤  (1s later)
  │◄──{ order:2, number:200 }─┤  (2s later)
  │◄──{ order:3, number:300 }─┤  (3s later)
  │◄──{ ... }────────────────┤
  │                          │
```

**Code flow** (`server.ts:25`):
```typescript
function getNumbers(call) {
  const count = call.request.count || 10;
  let current = 1;
  const intervalId = setInterval(() => {
    if (current > count) {
      clearInterval(intervalId);
      call.end();            // signal "no more data"
      return;
    }
    call.write({ order: current, number: current * 100 });
    current++;
  }, 1000);                  // one number every second
}
```

Key difference from unary: instead of a callback, use `call.write()` to push data and `call.end()` to finish the stream.

---

### 3. SumNumbers — Client Streaming RPC

**Pattern**: Client sends multiple messages → Server replies once with the aggregate.

```
Client                     Server
  │                          │
  │──{ number: 10 }─────────►│
  │──{ number: 20 }─────────►│  Server accumulates
  │──{ number: 30 }─────────►│  values as they arrive
  │──{ number: 40 }─────────►│
  │──{ number: 50 }─────────►│
  │──end────────────────────►│
  │                          │
  │◄───{ sum: 150 }─────────┤  Response after client ends
  │                          │
```

**Code flow** (`server.ts:41`):
```typescript
function sumNumbers(call, callback) {
  let sum = 0;
  call.on('data', (request) => { sum += request.number; });
  call.on('end', () => { callback(null, { sum }); });
}
```

The server listens for incoming data events and responds via callback only after the client signals the stream is complete.

---

### 4. Chat — Bidirectional Streaming RPC

**Pattern**: Both sides send messages independently over a single connection.

```
Client                     Server
  │                          │
  │──{ user, message }──────►│
  │◄──{ user, message }─────┤  Server echoes back
  │──{ user, message }──────►│
  │◄──{ user, message }─────┤
  │──end────────────────────►│
  │                          │
```

**Code flow** (`server.ts:54`):
```typescript
function chat(call) {
  call.on('data', (request) => {
    const reply = { user: 'server', message: `You said: ${request.message}` };
    call.write(reply);
  });
  call.on('end', () => { call.end(); });
}
```

Both sides use `call.write()` and `call.on('data')` — there is no callback pattern. This is the most flexible but also the most complex pattern.

## How Server & Client Connect

**Server** (`server.ts:67`):
```typescript
const server = new grpc.Server();
server.addService(greeterProto.Greeter.service, {
  sayHello, getNumbers, sumNumbers, chat  // ← register implementations
});
server.bindAsync('0.0.0.0:5050', grpc.ServerCredentials.createInsecure(), ...);
```

**Client** (`client.ts:18`):
```typescript
const client = new greeterProto.Greeter(
  'localhost:5050',
  grpc.credentials.createInsecure()
);
```

## Proto File — The Source of Truth

```protobuf
service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply);           // unary
  rpc GetNumbers(NumberRequest) returns (stream NumberResponse);  // server stream
  rpc SumNumbers(stream SumRequest) returns (SumResponse);        // client stream
  rpc Chat(stream ChatMessage) returns (stream ChatMessage);      // bidirectional
}
```

The `stream` keyword before a message type tells gRPC that multiple messages will be sent instead of one.

## Client.ts — What's Active

Currently only the **bidirectional Chat** is uncommented. To try the other three RPC types, uncomment the corresponding blocks in `client.ts`:

| Lines | RPC Type | What It Does |
|-------|----------|-------------|
| 24–30 | Unary | Calls `SayHello` with a name |
| 33–45 | Server Stream | Calls `GetNumbers` with count=5 |
| 48–61 | Client Stream | Calls `SumNumbers` with [10,20,30,40,50] |
| 64–84 | Bidirectional | Calls `Chat` with 3 messages |

## Scripts

| Command | Description |
|---------|------------|
| `pnpm run server` | Start the gRPC server on port 5050 |
| `pnpm run client` | Run the client (tests all active RPCs) |
| `pnpm run build` | Compile TypeScript to `./dist` |

## Customization

- **Port** — change `0.0.0.0:5050` in both `server.ts:77` and `client.ts:19`
- **Add a new RPC** → define it in `greeter.proto`, implement in `server.ts`, call from `client.ts`
- **Message format** — edit the proto messages and regenerate or update runtime access

## Common Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `ECONNREFUSED` | Server not running | Start the server first |
| `EADDRINUSE` | Port 5050 occupied | Kill the old process or change port |
| Proto file errors | Wrong path | `__dirname` resolves relative to source; keep `proto/` next to `.ts` files |

## Concurrency Considerations

### Safe — Single event loop
gRPC Node.js handlers run on JavaScript's single thread ([event-loop doc](../docs/event-loop.md)). Inside a single handler invocation, `data` events are serialized — no two events for the same call execute concurrently.

```typescript
// sumNumbers — safe, events are serialized by the event loop
call.on('data', (req) => { sum += req.number; });
```

### Guard — `call.write()` after `call.end()`
Calling `write()` on a closed stream throws an error. Always ensure the stream is still open before writing:

```typescript
// getNumbers — clearInterval prevents write after end
function getNumbers(call) {
  let current = 1;
  const timer = setInterval(() => {
    if (current > count) { clearInterval(timer); call.end(); return; }
    call.write({ order: current, ... });
    current++;
  }, 1000);
}
```

### Watch — async handlers and interleaved events
If a streaming handler uses `await`, other events for the same call can arrive before the `await` resolves. Buffer or coordinate if event order matters:

```typescript
// Unsafe — data events can interleave during await
call.on('data', async (req) => {
  await db.save(req);  // another 'data' event can fire here
});

// Safe — collect then process
const buffer: Request[] = [];
call.on('data', (req) => { buffer.push(req); });
call.on('end', async () => {
  for (const req of buffer) { await db.save(req); }
});
```

### Share — no shared mutable state
This demo is stateless. In production, if multiple RPC handlers access shared state (counters, caches, DB), use the same concurrency controls as any Node.js app — avoid read-modify-write without protection ([database-concurrency-control doc](../docs/database-concurrency-control.md)).

## Learn More

- [gRPC Concepts Overview](https://grpc.io/docs/what-is-grpc/core-concepts/)
- [Protocol Buffers](https://protobuf.dev/)
- [gRPC Node.js API](https://grpc.io/docs/languages/node/)
- [Event Loop — Node.js Concurrency Model](../docs/event-loop.md)
- [Promise APIs — Async Coordination](../docs/promise-apis.md)
