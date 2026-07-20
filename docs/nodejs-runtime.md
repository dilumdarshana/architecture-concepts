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
│  ┌──────────┐ ┌──────────┐ ┌────────────────────┐   │
│  │ libuv    │ │ V8 API   │ │  Other C libs       │   │
│  │ (uv_fs_*)│ │ (Isolate │ │  (c-ares: DNS,      │   │
│  │          │ │  Handle, │ │   llhttp: HTTP,      │   │
│  │          │ │  Context) │ │   OpenSSL: TLS)      │   │
│  └────┬─────┘ └────┬─────┘ └────────────────────┘   │
└───────┼─────────────┼───────────────────────────────┘
        │             │
┌───────▼─────────────▼───────────────────────────────┐
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

### c-ares — DNS Resolution

A separate C library used by libuv for DNS operations that libuv's built-in `getaddrinfo` cannot handle — specifically asynchronous DNS queries with custom resolvers. Used by the `dns` module for functions like `dns.resolve4`, `dns.resolveTxt`.

### llhttp — HTTP Parsing

A lightweight C library that parses HTTP requests and responses. Used by the `http` and `http2` modules. It is a callback-based state machine — it fires events (`on_message_begin`, `on_url`, `on_header_value`, `on_message_complete`) as it parses the byte stream.

### OpenSSL — TLS and Cryptography

Used by the `crypto` and `tls` modules for TLS/SSL encryption, hashing, HMAC, signing, and key generation.

---

## How it Works (Request Lifecycle)

A file read request traces through every component:

1. **V8** executes `fs.readFile('/etc/hosts', callback)` — calls into the core JS library.
2. **Core JS** (`fs.js`) validates the path, creates an internal `FSReqCallback` object, and calls the C++ binding.
3. **C++ binding** (`node_fs.cc`) creates a `uv_fs_t` request struct and calls `uv_fs_read` (libuv API).
4. **libuv** checks the OS: File I/O is not truly async on Linux/macOS, so libuv offloads it to the **thread pool** (one of 4 default threads).
5. **Thread pool** thread reads the file using blocking POSIX `read()` syscall, storing the result in the `uv_fs_t` struct.
6. When done, the thread queues a completion callback in the **pending** or **poll** phase of the event loop.
7. **Event loop** (main thread) picks up the callback, calls the C++ completion handler.
8. **C++ handler** copies the data from the libuv buffer into a V8 `Buffer` or `string`, and invokes the JavaScript callback.
9. **V8** executes the JavaScript callback with the result.
10. If there are no more pending operations, the event loop exits and the process terminates.

---

## Advantages

- **Single-threaded simplicity** — developers write sequential-looking code without managing threads
- **Non-blocking I/O** — one thread handles thousands of concurrent connections efficiently
- **Shared nothing** — no thread-safety bugs for I/O code (data is not shared across threads)
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

- [Event Loop](event-loop.md) — the 6-phase loop that libuv implements
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
