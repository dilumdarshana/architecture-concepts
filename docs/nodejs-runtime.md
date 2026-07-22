# Node.js Runtime Architecture

> The layered composition of V8, libuv, C++ bindings, and core JS libraries that together make Node.js run JavaScript outside the browser.

---

## What is it?

Node.js is not a single program — it is an integration of several independent components. At the top sits the **JavaScript engine (V8)** that compiles and executes JS code. Below it, **C++ bindings** expose low-level system operations. **libuv** provides the event loop, thread pool, and async I/O. The **core JS library** (fs, http, path, etc.) wraps these bindings into developer-friendly APIs. Together they create the runtime environment that makes async JavaScript on the server possible.

---

## Problem

JavaScript was designed for the browser, where the host environment (the browser) provides all I/O APIs. To run JavaScript on the server, Node.js needed:

- A way to read files, make network requests, and interact with the OS — none of which V8 provides
- A non-blocking I/O model so a single thread could handle thousands of concurrent connections
- A bridge between JavaScript (dynamic, garbage-collected) and C/C++ (manual memory, system-level APIs)

No single library solved all three. Node.js composes V8 (JS engine), libuv (async I/O), and handwritten C++ bindings into a cohesive runtime.

---

## Architecture / Flow

```text
┌─────────────────────────────────────────────────────┐
│                  JavaScript Code                      │
│  require('fs')  http.createServer  Buffer.alloc      │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│               Core JS Library                        │
│  fs.js  http.js  path.js  stream.js  os.js  ...     │
│  (JavaScript wrappers that call into bindings)       │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              C++ / C Bindings                        │
│  fs binding    TCP binding   crypto binding          │
│  (toggling/cc/)             (src/node_crypto.cc)     │
│  ┌──────────────────────────────────────────────┐    │
│  │                V8 Engine                      │    │
│  │  ┌──────────────┐  ┌──────────────────────┐  │    │
│  │  │ Call Stack    │  │  Microtask Queue     │  │    │
│  │  │ (exec frames) │  │  (Promise.then,      │  │    │
│  │  └──────────────┘  │   queueMicrotask)     │  │    │
│  │                    └──────────────────────┘  │    │
│  │  Memory heap, GC, JIT compiler               │    │
│  └──────────────────────────────────────────────┘    │
│                                                       │
│  ┌──────────────────────────────────────────────┐    │
│  │               libuv                           │    │
│  │  ┌────────────────┐  ┌──────────────────┐    │    │
│  │  │ Event Loop      │  │  nextTick Queue  │    │    │
│  │  │ (6 phases)      │  │  (managed by     │    │    │
│  │  │                 │  │   Node.js, not   │    │    │
│  │  │  timers ──►     │  │   libuv itself)  │    │    │
│  │  │  pending ──►    │  └──────────────────┘    │    │
│  │  │  idle/prep ──►  │                          │    │
│  │  │  poll ──────────┐                          │    │
│  │  │  check ──►      │  Phase callback queues:  │    │
│  │  │  close ──►      │  Each phase has its own  │    │
│  │  └────────────────┘  fifo queue of callbacks  │    │
│  │                      (macrotask queues)        │    │
│  │  Thread pool (4)                               │    │
│  │  Timer heap                                     │    │
│  └──────────────────────────────────────────────┘    │
│                                                       │
│  ┌──────────────────────────────────────────────┐    │
│  │  Other C libs                                │    │
│  │  c-ares (DNS)  llhttp (HTTP)  OpenSSL (TLS)  │    │
│  └──────────────────────────────────────────────┘    │
└───────────────────────┬──────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────┐
│                   Operating System                    │
│  Linux / macOS / Windows                              │
│  Kernel: epoll / kqueue / IOCP                       │
│  File system, sockets, signals, threads              │
└─────────────────────────────────────────────────────┘
```

---

## Components

### V8 — JavaScript Engine

V8 is the JavaScript engine developed by Google for Chrome. It compiles JavaScript to native machine code (JIT compilation) rather than interpreting it.

| Responsibility | Details |
|----------------|---------|
| **Parsing** | Converts JS source code into an Abstract Syntax Tree (AST) |
| **JIT compilation** | Compiles hot functions to native machine code (TurboFan, Sparkplug) |
| **Memory management** | Heap allocation, garbage collection (Orinoco: minor/major GC, concurrent marking) |
| **Call stack** | Manages execution contexts, function calls, and stack frames |
| **Data types** | Implements JS types (Object, Array, Number, String, etc.) and their internal representations |
| **Optimisation/deoptimisation** | Monitors execution and optimises hot paths; deoptimises when assumptions break |

What V8 does NOT provide: file system access, networking, timers, threading, or any OS interaction. These are provided by other components.

### libuv — Async I/O and Event Loop

libuv is the C library that implements Node.js's asynchronous I/O model. It was originally developed for Node.js and is now used by other projects (Luvit, Julia).

| Responsibility | Details |
|----------------|---------|
| **Event loop** | Implements the 6-phase event loop (timers, pending, idle/prepare, poll, check, close) |
| **Thread pool** | Default 4 threads (configurable via `UV_THREADPOOL_SIZE`) for I/O operations that the OS cannot do asynchronously — file system, DNS, `crypto.pbkdf2`, `zlib` |
| **Async I/O** | Wraps OS-specific async I/O primitives: `epoll` (Linux), `kqueue` (macOS), `IOCP` (Windows) |
| **Timer management** | Maintains a min-heap of timer callbacks ordered by expiration time; sets OS timers for the earliest expiration |
| **Signal handling** | Registers signal handlers (SIGINT, SIGTERM) and delivers them safely to the event loop |
| **Socket / pipe handling** | TCP and UDP socket operations, Unix domain sockets, pipe streams |
| **DNS resolution** | `getaddrinfo` and `getnameinfo` — runs on the thread pool |

### C++ Bindings (src/ directory)

These are handwritten C++ files that bridge JavaScript calls (via the Core JS Library) to libuv or directly to the OS. They use V8's API to expose C++ functions as JavaScript functions.

| Binding | What it Exposes |
|---------|-----------------|
| `node_fs.cc` | `fs.readFile`, `fs.writeFile`, `fs.stat` — delegates to `uv_fs_*` |
| `node_tcp.cc` | `net.Socket`, `net.Server` — wraps `uv_tcp_t` |
| `node_udp.cc` | `dgram` module — wraps `uv_udp_t` |
| `node_crypto.cc` | `crypto` module — wraps OpenSSL |
| `node_zlib.cc` | `zlib` module — wraps zlib compression library |
| `node_http2.cc` | `http2` module — wraps nghttp2 |

The binding process:

```text
JS: fs.readFile(path, cb)
  │
  ▼
Core JS Library (fs.js): validates arguments, creates a
JavaScript wrapper object (FSReqCallback), calls into
the C++ binding via `internalBinding('fs')`
  │
  ▼
C++ Binding (node_fs.cc): creates a libuv request
(`uv_fs_t`), calls `uv_fs_read` (or `uv_fs_stat` etc.),
registers the completion callback
  │
  ▼
libuv: submits the operation to the thread pool (for
file I/O), or to the OS async mechanism (for sockets).
When done, libuv queues the callback in the poll phase
  │
  ▼
Event Loop: picks up the callback, calls the C++
completion handler, which resolves the JS Promise
or calls the JS callback
```

### Core JS Library (lib/ directory)

This is the JavaScript layer that developers interact with directly. It wraps the C++ bindings with user-friendly APIs.

| Module | Responsibility |
|--------|----------------|
| `fs.js` | `readFile`, `writeFile`, `createReadStream`, `watch` — delegates to `node_fs.cc` |
| `http.js` | `createServer`, `request` — wraps `node_http.cc` / `node_http2.cc` |
| `net.js` | `Socket`, `Server` — wraps `node_tcp.cc` |
| `stream.js` | Readable, Writable, Transform, Duplex — implements the stream protocol on top of underlying bindings |
| `path.js` | Platform-agnostic path manipulation — pure JS, no bindings |
| `buffer.js` | `Buffer` class — wraps `node_buffer.cc` for raw memory allocation |
| `events.js` | `EventEmitter` — pure JS, foundation for all async event handling |

### Module System

Node.js supports two module systems that coexist in the same runtime. The module loader is implemented in JavaScript (`lib/internal/modules/`) and sits in the **Core JS Library** layer — it is not part of V8 or libuv.

| Aspect | CommonJS (CJS) | ES Modules (ESM) |
|--------|---------------|------------------|
| **Syntax** | `require('./foo')`, `module.exports = ...` | `import { foo } from './foo.js'`, `export const foo = ...` |
| **Loader location** | `lib/internal/modules/cjs/` | `lib/internal/modules/esm/` |
| **Resolution** | Synchronous — `require` blocks until the module is loaded and evaluated | Asynchronous — `import` returns a promise; static imports are resolved before execution begins |
| **File extension** | `.js`, `.json`, `.node` (`.js` is CJS by default unless `"type": "module"` in package.json) | `.mjs`, or `.js` with `"type": "module"` in package.json |
| **Caching** | Modules are cached after first `require`; subsequent calls return the cached export | Modules are cached after first evaluation; `import` always returns the same module record |
| **Top-level await** | Not supported | Supported (in ESM, `await` is valid at the top level) |
| **Cyclic references** | Handled — returns partially populated exports at the time of the cycle | Handled — uses live bindings that update as the module evaluates |

#### Module Resolution Algorithm (CJS)

When you call `require('lodash')`, Node.js follows this chain:

1. Check if it is a **built-in module** (`fs`, `http`, `path`, etc.) — return immediately.
2. Check if the path starts with `./` or `../` — resolve relative to the calling file.
3. If neither, treat it as a **node_modules lookup** — walk up the directory tree looking for `node_modules/lodash`.
4. Inside the package directory, consult `package.json` fields in order: `"exports"`, `"main"`.
5. If no package.json or no matching field, look for `index.js`, `index.json`, `index.node`.
6. If the resolved path ends with `.js`, load as JavaScript; `.json`, parse as JSON; `.node`, load as a compiled C++ addon.

```text
require('lodash')
    │
    ├── built-in? (fs, http...) ──► return built-in module
    │
    ├── relative? (./ or ../) ──► resolve relative to __dirname
    │
    └── node_modules lookup
          │
          └── /app/node_modules/lodash/
                │
                ├── package.json: "main": "index.js"
                └── index.js ──► load and cache
```

#### ESM Module Resolution

ESM uses a similar algorithm but with an asynchronous phase. The loader discovers the full dependency graph before executing any module. This enables **top-level await** and **live bindings** (exported values are bound by reference, not by value).

```typescript
// ESM — live bindings
// counter.js
export let count = 0;
export function increment() { count++; }

// main.js
import { count, increment } from './counter.js';
console.log(count); // 0
increment();
console.log(count); // 1 — the binding is live, not a copy
```

#### CJS / ESM Interop

The two systems can interoperate with caveats:

| Operation | Works? | Behaviour |
|-----------|--------|-----------|
| CJS `require` an ESM module | No | Throws `ERR_REQUIRE_ESM` — ESM modules cannot be loaded via `require` |
| ESM `import` a CJS module | Yes | The CJS module's `module.exports` is available as the default export |
| ESM dynamic `import()` a CJS module | Yes | Returns a promise that resolves to the module's exports |
| ESM `import` a JSON file | Yes (with import assertions) | `import data from './data.json' assert { type: 'json' }` |

```typescript
// utils.cjs — CommonJS
module.exports = { greet: (name) => `Hello, ${name}!` };

// app.mjs — ES Module
import { greet } from './utils.cjs'; // OK: CJS → ESM
console.log(greet('World'));

// Dynamic import — works in both CJS and ESM
async function loadModule(name: string) {
  const mod = await import(`./plugins/${name}.mjs`);
  return mod.default;
}
```

#### Package.json `exports` Field

The modern way to define a package's public API. It replaces `"main"` and enables subpath exports, conditional exports, and encapsulation (private modules cannot be imported).

```json
{
  "name": "my-lib",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    },
    "./utils": {
      "import": "./dist/utils.mjs",
      "require": "./dist/utils.cjs"
    }
  }
}
```

```typescript
import { thing } from 'my-lib';           // OK — maps to dist/index.mjs
import { util } from 'my-lib/utils';       // OK — maps to dist/utils.mjs
import { internal } from 'my-lib/internal'; // ERR — not in "exports"
```

### c-ares — DNS Resolution

A separate C library used by libuv for DNS operations that libuv's built-in `getaddrinfo` cannot handle — specifically asynchronous DNS queries with custom resolvers. Used by the `dns` module for functions like `dns.resolve4`, `dns.resolveTxt`.

### llhttp — HTTP Parsing

A lightweight C library that parses HTTP requests and responses. Used by the `http` and `http2` modules. It is a callback-based state machine — it fires events (`on_message_begin`, `on_url`, `on_header_value`, `on_message_complete`) as it parses the byte stream.

### OpenSSL — TLS and Cryptography

Used by the `crypto` and `tls` modules for TLS/SSL encryption, hashing, HMAC, signing, and key generation.

---

## Task Queues: Microtasks, Macrotasks, and nextTick

The runtime does not execute callbacks directly from a single queue. There are three distinct queue layers, each owned by a different component, with strict priority rules.

### Ownership

| Queue | Owner | Contains | Runs |
|-------|-------|----------|------|
| **Microtask queue** | V8 | `Promise.then`, `Promise.catch`, `queueMicrotask`, `MutationObserver` | After every single JS callback returns, and between every event loop phase |
| **nextTick queue** | Node.js (not V8, not libuv) | `process.nextTick` callbacks | After every single JS callback returns, **before** V8's microtask queue |
| **Macrotask (phase) queues** | libuv | `setTimeout`/`setInterval` callbacks (timer phase), I/O callbacks (poll phase), `setImmediate` (check phase), close callbacks (close phase) | One phase at a time, in order; each phase empties its queue before the next phase starts |

### Execution Order

```text
Call Stack Empty?
    │
    ├── YES: drain nextTick queue (entirely)
    │         │
    │         └── drain V8 microtask queue (entirely)
    │                    │
    │                    └── proceed to one event loop phase
    │                              │
    │                              └── execute ONE macrotask from that phase
    │                                         │
    │                                         └── repeat (check call stack again)
    │
    └── NO: keep executing on the call stack

Priority: nextTick > microtask > macrotask (timer phase → I/O → check → close)
```

### Visual Timeline

```text
Call Stack
   │
   ├── callback A runs
   │     ├── setTimeout(cb, 0)  ──► macrotask (timer phase queue)
   │     ├── Promise.resolve().then(fn)  ──► V8 microtask queue
   │     └── process.nextTick(fn)  ──► nextTick queue
   │
   ├── callback A returns (stack empty)
   │
   ├── CHECKPOINT: drain nextTick queue (entirely)
   │     └── nextTick fn runs
   │
   ├── CHECKPOINT: drain V8 microtask queue (entirely)
   │     └── Promise fn runs
   │
   ├── Event loop enters timer phase
   │     └── setTimeout cb runs (one macrotask)
   │
   ├── callback returns (stack empty)
   │
   ├── CHECKPOINT: drain nextTick queue (none pending)
   ├── CHECKPOINT: drain V8 microtask queue (none pending)
   │
   └── Event loop moves to next phase (pending callbacks)
```

### Why nextTick exists separately from V8 microtasks

`process.nextTick` predates Promise-based microtasks in Node.js. It was the original way to defer work until after the current operation but before any I/O. It runs **before** V8's microtasks even though both drain at the same checkpoint:

```typescript
process.nextTick(() => console.log('nextTick'));
Promise.resolve().then(() => console.log('microtask'));

// Output:
// nextTick
// microtask
```

Note: `process.nextTick` has no equivalent in browser JavaScript. It is a Node.js-specific API. In modern Node.js code, `queueMicrotask` or `Promise.resolve().then(...)` is preferred over `process.nextTick` because microtask ordering is standardised and portable. See the Node.js docs warning: `process.nextTick` can starve the event loop if called recursively.

### Phase Queues (Macrotask Queues) in Detail

Each event loop phase has its own FIFO queue of callbacks. When the event loop enters a phase, it drains that phase's queue entirely (or up to a hard limit in the poll phase) before moving on:

```text
Timer phase queue:    [cb1(150ms), cb2(200ms), cb3(150ms)]
                         │
pending phase queue:    [tcp_error_cb, udp_send_cb]
                         │
poll phase queue:       [fs_read_cb, http_data_cb]
                         │
check phase queue:      [setImmediate_cb1, setImmediate_cb2]
                         │
close phase queue:      [socket_close_cb]
```

Between draining each phase, the runtime drains **nextTick** then **microtask** queues entirely.

---

## How it Works (Request Lifecycle)

A file read request traces through every component, including the task queues:

1. **V8** executes `fs.readFile('/etc/hosts', callback)` — calls into the core JS library.
2. **Core JS** (`fs.js`) validates the path, creates an internal `FSReqCallback` object, and calls the C++ binding.
3. **C++ binding** (`node_fs.cc`) creates a `uv_fs_t` request struct and calls `uv_fs_read` (libuv API).
4. **libuv** checks the OS: File I/O is not truly async on Linux/macOS, so libuv offloads it to the **thread pool** (one of 4 default threads).
5. **Thread pool** thread reads the file using blocking POSIX `read()` syscall, storing the result in the `uv_fs_t` struct.
6. When done, the thread queues a completion callback in the **poll phase's macrotask queue**.
7. **Event loop** (main thread) finishes its current work and enters the poll phase. It picks the completion callback and executes it.
8. **C++ handler** copies the data from the libuv buffer into a V8 `Buffer` or `string`, and invokes the JavaScript callback.
9. **V8** executes the JavaScript callback. During execution, any `Promise.then` or `process.nextTick` are queued.
10. When the callback returns and the **call stack is empty**, the runtime drains the **nextTick queue**, then the **V8 microtask queue**.
11. The event loop moves to the **check phase** (setImmediate), then **close phase**, then loops back to **timers**.
12. If there are no more pending operations in any phase and no active handles, the event loop exits and the process terminates.

---

## Advantages

- **Single-threaded simplicity** — developers write sequential-looking code without managing threads
- **Non-blocking I/O** — one thread handles thousands of concurrent connections efficiently
- **Shared nothing** — no data-race bugs for I/O code (JS objects are not shared across threads); logic-level race conditions from async interleaving can still occur (see [Race Conditions](nodejs-race-conditions.md))
- **Component isolation** — V8, libuv, and bindings are independently maintained and improved
- **Extensibility** — C++ addons (N-API) allow native modules to integrate at the binding layer

---

## Trade-offs

- **Single-threaded bottleneck** — CPU-bound work blocks the event loop (see [Concurrency vs Parallelism](concurrency-vs-parallelism.md))
- **Thread pool size** — default 4 threads limits concurrent file I/O and crypto; must tune for the workload
- **Callback complexity** — async error handling requires careful patterns (see [Error Handling (Express)](error-handling.md))
- **Native module compatibility** — C++ addons must be recompiled for each Node.js version (N-API mitigates this)

---

## Related Concepts

- [Event Loop](event-loop.md) — the 6-phase loop that libuv implements; detailed phase behaviour and microtask ordering
- [Concurrency vs Parallelism](concurrency-vs-parallelism.md) — V8 runs JS on one thread; libuv thread pool handles I/O; worker threads provide CPU parallelism
- [Cancellation & Timeouts](cancellation-timeouts.md) — `AbortController` is a JS API; the underlying timer tracking is done by libuv
- [Graceful Shutdown](graceful-shutdown.md) — signal handling via libuv; event loop drains phases before exit
- libuv
- V8
- N-API
- C++ Addons

---

## Key Takeaways

> Node.js composes V8 (JS engine), libuv (event loop + thread pool), C++ bindings (bridge), and a core JS library (user-facing APIs). V8 parses and executes JavaScript but provides no I/O capabilities. libuv provides the event loop that makes Node.js non-blocking — it wraps OS-specific async primitives and provides a thread pool for operations that cannot be async at the OS level. The C++ bindings translate JavaScript calls into libuv operations and expose system functionality (file system, networking, crypto) back to JavaScript. Together, these components create a runtime that handles thousands of concurrent I/O operations on a single thread.
