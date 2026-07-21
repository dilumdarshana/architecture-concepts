# gRPC

> A high-performance RPC framework using Protocol Buffers and HTTP/2 for typed, streaming, and polyglot inter-service communication.

---

## What is it?

gRPC is a Remote Procedure Call (RPC) framework developed by Google. It uses **Protocol Buffers** (protobuf) as the interface definition language and serialisation format, and **HTTP/2** as the transport. A client can call a method on a server in a different process or data centre as if it were a local function call. gRPC supports four communication patterns: unary, server streaming, client streaming, and bidirectional streaming.

---

## Problem

Building inter-service communication with REST over HTTP/1.1 has several pain points:

- **No schema contract** — REST APIs are documented separately (OpenAPI), with no compile-time type safety between services
- **HTTP/1.1 overhead** — one request per connection; header compression is absent; no multiplexing
- **No built-in streaming** — real-time feeds require WebSocket or SSE (separate protocol, separate lifecycle)
- **Manual code generation** — each language needs its own client SDK; keeping clients in sync with the server is manual work
- **Inefficient serialisation** — JSON is text-based, verbose, and slow to parse at scale

gRPC solves all of these by defining the service contract in a `.proto` file (the single source of truth), generating strongly-typed clients in any supported language, streaming over a single HTTP/2 connection, and using binary protobuf serialisation.

---

## Example

### Proto Definition (the source of truth)

```protobuf
syntax = "proto3";

package greeter;

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply);
  rpc GetNumbers(NumberRequest) returns (stream NumberResponse);
  rpc SumNumbers(stream SumRequest) returns (SumResponse);
  rpc Chat(stream ChatMessage) returns (stream ChatMessage);
}

message HelloRequest { string name = 1; }
message HelloReply   { string message = 1; }
message NumberRequest { int32 count = 1; }
message NumberResponse { int32 order = 1; int32 number = 2; }
message SumRequest { int32 number = 1; }
message SumResponse { int32 sum = 1; }
message ChatMessage { string user = 1; string message = 2; }
```

The `stream` keyword before a message type means multiple messages are sent instead of one. The `package greeter` line maps to the namespace used in the generated code.

### Node.js / TypeScript — Server (Unary RPC)

```typescript
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const PROTO_PATH = './proto/greeter.proto';
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
});
const greeterProto = grpc.loadPackageDefinition(packageDefinition).greeter as any;

function sayHello(call: any, callback: any) {
  callback(null, { message: `Hello ${call.request.name}!!!` });
}

const server = new grpc.Server();
server.addService(greeterProto.Greeter.service, { sayHello });
server.bindAsync('0.0.0.0:5050', grpc.ServerCredentials.createInsecure(), () => {
  console.log('Server running on port 5050');
});
```

### Node.js / TypeScript — Client (Unary RPC)

```typescript
const client = new greeterProto.Greeter(
  'localhost:5050',
  grpc.credentials.createInsecure()
);

client.sayHello({ name: 'TypeScript' }, (error: any, response: any) => {
  console.log('Response:', response.message);
});
```

The `.proto` file is loaded at runtime via `@grpc/proto-loader`. The server registers implementations of the defined RPC methods. The client calls them — they look like local function calls.

---

## Architecture / Flow

### The 4 RPC Types

```
1. Unary                    2. Server Streaming
Client         Server        Client         Server
  │              │             │              │
  │── request ──►│             │── request ──►│
  │              │             │              │
  │◄── response ─┤             │◄── stream ───┤
  │              │             │◄── stream ───┤
                               │◄── stream ───┤
                               │              │
                               │◄── end ──────┤

3. Client Streaming          4. Bidirectional
Client         Server        Client         Server
  │              │             │              │
  │── stream ───►│             │── stream ───►│
  │── stream ───►│             │◄── stream ───┤
  │── stream ───►│             │── stream ───►│
  │              │             │◄── stream ───┤
  │── end ──────►│             │              │
  │              │             │── end ──────►│
  │◄── response ─┤             │◄── end ──────┤
```

### Protocol Stack

```
Application        gRPC methods (sayHello, getNumbers, ...)
Code Gen           Protobuf-generated client/server stubs
Serialisation      Protocol Buffers (binary, schema-driven)
Transport          HTTP/2 (multiplexed, header compression, streaming)
Network            TCP
```

---

## How it Works

1. **Define the contract** — write a `.proto` file specifying the service interface, RPC methods, and message shapes.
2. **Generate code** (or load at runtime) — proto-loader deserialises the definition into a gRPC service object with stubs for every method.
3. **Client opens an HTTP/2 connection** — a single TCP connection is established; all subsequent RPCs share it (multiplexing).
4. **Client serialises the request** — the input message is encoded into binary protobuf format and sent in an HTTP/2 data frame.
5. **Server deserialises and processes** — the server reads the binary payload, decodes it into the typed message, and calls the handler.
6. **Server serialises the response** — the response message is encoded into binary protobuf and sent back in HTTP/2 frames.
7. **Streaming** — for `stream` methods, multiple frames are sent on the same HTTP/2 stream. The client or server reads them incrementally via callback events (`on('data', ...)`).
8. **Stream lifecycle** — the stream producer calls `call.write()` for each message and `call.end()` to signal completion. The consumer listens to `data` and `end` events.

---

## Advantages

- **Strongly typed contracts** — the `.proto` file is the single source of truth; clients and servers are generated from it
- **Polyglot** — protobuf code gen produces libraries for C++, Java, Go, Python, Node.js, .NET, and more
- **Four communication patterns** — unary, server stream, client stream, bidirectional — covering request-reply, push, batch upload, and chat
- **HTTP/2 multiplexing** — a single connection carries multiple simultaneous RPCs without head-of-line blocking
- **Binary serialisation** — protobuf is compact and fast to encode/decode vs JSON
- **Built-in deadline/timeout** — every RPC can have a deadline; the framework enforces it
- **Flow control** — HTTP/2 stream-level flow control prevents a fast producer from overwhelming a slow consumer

---

## Trade-offs

- **Browser support is limited** — gRPC-Web is a separate protocol (requires a proxy or special library); gRPC is primarily designed for server-to-server
- **Protobuf learning curve** — teams must learn a new IDL, field numbering, backward-compatibility rules, and codegen tooling
- **Readability** — binary payloads cannot be inspected with `curl` or browser dev tools; `grpcurl` or a reflection API is needed
- **HTTP/2 complexity** — some load balancers and proxies handle HTTP/2 poorly; TLS is strongly recommended but adds operational overhead
- **No built-in caching** — gRPC does not support HTTP caching semantics (ETags, cache-control); caching must be implemented at the application layer
- **Larger initial effort** — adding a new RPC requires editing the proto file, regenerating stubs, and redeploying both sides

---

## When to Use

- **Microservices** — strongly typed contracts between services in different languages
- **Polyglot environments** — teams using different languages need a common communication contract
- **Real-time streaming** — server push, live updates, event feeds (use server streaming or bidirectional)
- **High-throughput systems** — binary protobuf and HTTP/2 multiplexing reduce CPU and bandwidth
- **Mobile clients** — protobuf's compact payloads save battery and bandwidth on mobile networks
- **Internal APIs** — gRPC excels within a trusted network where browser clients are not the primary consumer

---

## When NOT to Use

- **Public-facing APIs consumed by browsers** — REST or GraphQL with JSON is simpler for web clients
- **Simple CRUD services** — REST is easier to document, test, and debug for straightforward data operations
- **Low-throughput, small teams** — the protobuf toolchain and HTTP/2 overhead are not justified
- **Teams unfamiliar with protobuf** — field numbering, backward compatibility, and codegen add friction

---

## Related Concepts

- [Distributed Systems](distributed-systems.md) — gRPC is a common synchronous communication mechanism between distributed services
- [Message Queues](message-queues.md) — gRPC for request-reply; message queues for async pub/sub; they complement each other
- [Circuit Breaker](circuit-breaker.md) — `gRPC calls are synchronous and fail-prone; wrap them with a circuit breaker for resilience
- [Event-Driven Architecture](event-driven-architecture.md) — gRPC streaming enables event-driven patterns within a single connection; EDA extends it across services
- [Service Discovery](service-discovery.md) — gRPC clients need to locate servers; DNS-based service discovery resolves service names to pod IPs

---

## Key Takeaways

> gRPC uses Protocol Buffers and HTTP/2 to provide a high-performance, strongly typed RPC framework with four communication patterns: unary, server streaming, client streaming, and bidirectional. The `.proto` file is the single source of truth — code generation produces type-safe clients in any supported language. gRPC is ideal for internal microservices communication, especially in polyglot or high-throughput environments. For browser-facing APIs, REST or GraphQL are simpler alternatives. Always pair gRPC with a circuit breaker and service discovery for production reliability.
