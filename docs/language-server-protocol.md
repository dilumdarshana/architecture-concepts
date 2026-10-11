# Language Server Protocol (LSP)

> A JSON-RPC protocol that standardises how editors and IDEs talk to language tooling, so one language server works across every editor.

---

## What is it?

The Language Server Protocol (LSP) is a protocol — JSON-RPC 2.0 over stdio, TCP, or WebSocket — that defines the messages exchanged between an **editor** (the client) and a **language server** (a background process that understands a language deeply). Instead of every editor reimplementing autocomplete, go-to-definition, and diagnostics for every language, the editor speaks LSP once and the language server implements the features once.

The protocol covers the full editing lifecycle: document open/change/close, hover, completion, go-to-definition, references, rename, diagnostics, formatting, code actions, and more. The reference implementation is written in TypeScript (`vscode-languageserver`), which is why Node.js is the most common host for language servers.

---

## Problem

Language tooling has an **N × M problem**:

- Every editor (VS Code, Vim, Emacs, JetBrains, Sublime) had to write a bespoke plugin for every language (TypeScript, Python, Go, Rust, ...).
- Language authors had to maintain N editor plugins; editor authors had to maintain M language integrations.
- The hard part — parsing, building an AST, resolving symbols, type checking — was reimplemented once per editor per language.
- Features drifted: the same language behaved differently in different editors.

LSP collapses N × M into N + M: the editor implements the protocol once, the language server implements the language once, and the two interoperate.

---

## Example

### The Message Shape (JSON-RPC)

Every message is a JSON-RPC 2.0 object. Requests have an `id` and a `method`; notifications have no `id` (no response expected).

```json
// Editor → Server: handshake
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"processId":1234,"rootUri":"file:///repo","capabilities":{}}}

// Server → Editor: what it can do
{"jsonrpc":"2.0","id":1,"result":{"capabilities":{"textDocumentSync":2,"hoverProvider":true,"completionProvider":{"triggerCharacters":["."]}},"serverInfo":{"name":"example-lsp","version":"0.1.0"}}}

// Editor → Server: user hovered over a symbol
{"jsonrpc":"2.0","id":2,"method":"textDocument/hover","params":{"textDocument":{"uri":"file:///repo/src/index.ts"},"position":{"line":3,"character":12}}}

// Server → Editor: the hover result
{"jsonrpc":"2.0","id":2,"result":{"contents":{"kind":"markdown","value":"**greet** — a function"}}}
```

### Node.js / TypeScript — Language Server

A minimal server using the reference implementation. It advertises hover, completion, and incremental sync, then answers requests and pushes diagnostics.

```typescript
import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  Diagnostic,
  DiagnosticSeverity,
  CompletionItemKind,
  Position,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// 1. Handshake — tell the editor what we can do
connection.onInitialize((_params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      hoverProvider: true,
      completionProvider: { triggerCharacters: ['.'] },
    },
    serverInfo: { name: 'example-lsp', version: '0.1.0' },
  };
});

// 2. Hover — return the word under the cursor
connection.onHover((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;
  const word = wordAt(doc, params.position);
  if (!word) return null;
  return {
    contents: { kind: 'markdown', value: `**${word}** — hovered by example-lsp` },
  };
});

// 3. Completion — suggest identifiers
connection.onCompletion(() => ({
  isIncomplete: false,
  items: [
    { label: 'greet', kind: CompletionItemKind.Function, detail: 'function' },
    { label: 'config', kind: CompletionItemKind.Function, detail: 'function' },
  ],
}));

// 4. Diagnostics — push problems as the document changes
documents.onDidChangeContent((change) => {
  connection.sendDiagnostics({
    uri: change.document.uri,
    diagnostics: validate(change.document),
  });
});

function validate(doc: TextDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  doc.getText().split('\n').forEach((line, i) => {
    if (line.length > 80) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: {
          start: { line: i, character: 80 },
          end: { line: i, character: line.length },
        },
        message: 'Line exceeds 80 characters',
        source: 'example-lsp',
      });
    }
  });
  return diagnostics;
}

function wordAt(doc: TextDocument, position: Position): string {
  const line = doc.getText({
    start: { line: position.line, character: 0 },
    end: { line: position.line + 1, character: 0 },
  });
  const before = line.slice(0, position.character);
  const after = line.slice(position.character);
  const start = before.search(/[A-Za-z0-9_]*$/);
  const end = after.search(/[^A-Za-z0-9_]/);
  return line.slice(start, end === -1 ? line.length : position.character + end);
}

documents.listen(connection);
connection.listen();
```

### Node.js / TypeScript — Editor Client

The editor side spawns the server as a child process and speaks to it over stdio:

```typescript
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

const serverOptions: ServerOptions = {
  run: { module: './out/server.js', transport: TransportKind.stdio },
  debug: {
    module: './out/server.js',
    transport: TransportKind.stdio,
    options: { execArgv: ['--inspect=6009'] },
  },
};

const clientOptions: LanguageClientOptions = {
  documentSelector: [{ scheme: 'file', language: 'plaintext' }],
};

const client = new LanguageClient('exampleLsp', 'Example LSP', serverOptions, clientOptions);
client.start();
```

---

## Architecture / Flow

```text
┌──────────────────────────────┐
│           Editor             │
│  ┌────────────────────────┐  │
│  │  LSP Client (extension)│  │
│  └───────────┬────────────┘  │
└──────────────┼───────────────┘
               │ JSON-RPC 2.0
               │ stdio / TCP / WebSocket
               ▼
┌──────────────────────────────┐
│       Language Server        │
│  ┌────────────────────────┐  │
│  │  Protocol handlers     │  │
│  │  (hover, completion,   │  │
│  │   diagnostics, ...)    │  │
│  └───────────┬────────────┘  │
│              ▼               │
│  ┌────────────────────────┐  │
│  │  Analysis engine       │  │
│  │  (parser, AST, symbol  │  │
│  │   table, type checker) │  │
│  └────────────────────────┘  │
└──────────────────────────────┘

Hover sequence:
  Editor ──textDocument/didOpen──────────► Server   (server builds document model)
  Editor ──textDocument/hover (id:2)─────► Server
  Server ──result: markdown contents──────► Editor
  Server ──publishDiagnostics (notification)► Editor (pushed, no request needed)
```

The editor owns the UI and the document buffer; the server owns the language understanding. The two never share memory — only JSON-RPC messages over a pipe.

---

## How it Works

1. **Spawn** — the editor starts the language server as a child process (or connects over TCP/WebSocket) and speaks JSON-RPC 2.0 over stdio.
2. **Initialize handshake** — the editor sends `initialize` with its own capabilities; the server replies with the features it supports (`textDocumentSync`, `hoverProvider`, `completionProvider`, ...). Both sides then know what the other can do.
3. **`initialized` notification** — the editor confirms the handshake is complete; the server may now send requests of its own (e.g. `workspace/configuration`).
4. **Document sync** — the editor sends `textDocument/didOpen`, then `textDocument/didChange` with either full or incremental edits. The server keeps its own copy of the document and its analysis up to date.
5. **Push diagnostics** — the server sends `textDocument/publishDiagnostics` notifications whenever its analysis finds problems; the editor renders them as squiggles. No request needed — this is a notification.
6. **Request features** — the user hovers, types, or jumps; the editor sends `textDocument/hover`, `textDocument/completion`, `textDocument/definition`, etc. The server answers with structured results (markdown, completion items, locations).
7. **Cancellation and progress** — long operations can be cancelled via `$/cancelRequest` and report progress via `$/progress`, so the editor stays responsive.
8. **Shutdown** — the editor sends `shutdown` (a request), then `exit` (a notification); the server cleans up and terminates.

---

## Advantages

- **N + M instead of N × M** — one language server per language, one LSP client per editor; every combination works
- **One implementation to maintain** — language authors write the analysis once and get every editor for free
- **Editor-agnostic** — VS Code, Vim, Emacs, JetBrains, and CLI tools all consume the same protocol
- **Standardised feature set** — hover, completion, definition, references, rename, formatting, code actions, diagnostics are defined once
- **Incremental sync** — only changed ranges are sent, keeping analysis cheap on large files
- **Cancellation and progress** — long-running analysis stays responsive and observable
- **Reusable outside the editor** — the same server can power CI linting, documentation generation, and headless tooling
- **Versioned protocol** — capability negotiation lets old clients talk to new servers and vice versa

---

## Trade-offs

- **JSON-RPC overhead** — every interaction is a serialised message over a pipe; hot paths (keystroke completion) need incremental analysis to stay fast
- **Process lifecycle** — the editor must spawn, monitor, and restart the server; a crash mid-session needs recovery logic
- **Latency** — the server must keep its analysis warm; a cold start means a slow first hover
- **Capability negotiation complexity** — both sides must handle partial feature support gracefully
- **Hard to debug** — the server runs as a separate process; tracing messages requires a protocol logger or a debugger attach
- **Memory per server** — each project gets its own server process and its own analysis state
- **No UI vocabulary** — LSP has no concept of editor chrome; anything visual (panels, buttons, custom widgets) still needs editor-specific extension code

---

## When to Use

- **Language tooling for editors** — autocomplete, go-to-definition, rename, diagnostics for a programming language
- **Cross-editor support** — you want one implementation to work in VS Code, Vim, Emacs, and JetBrains
- **Reusing analysis in CI** — the same server that powers the editor can run diagnostics in a build pipeline
- **Multi-language monorepos** — each language gets its own server, all speaking the same protocol to the same editor
- **Domain-specific languages** — config files, DSLs, and query languages benefit from the same tooling without building an editor

---

## When NOT to Use

- **Single-editor plugin** — if you only target one editor, its native extension API is simpler and more powerful
- **Syntax highlighting only** — TextMate grammars or editor tokenisers are far cheaper than a full server
- **Performance-critical inline analysis** — if analysis must run in microseconds inside the editor's process, a separate server adds too much latency
- **Editor-specific UI** — LSP cannot express custom panels or widgets; those need native extension code anyway
- **Tiny languages with no analysis** — a server is overkill when there is no symbol table or type system to maintain

---

## Related Concepts

- [gRPC](grpc.md) — another RPC protocol; LSP uses JSON-RPC over stdio, gRPC uses protobuf over HTTP/2
- [REST](rest.md) — resource-oriented HTTP APIs; LSP is a message-based RPC protocol, not a resource model
- [API Versioning](api-versioning.md) — LSP's capability negotiation is a form of feature negotiation between client and server
- [Backpressure](backpressure.md) — cancellation and progress notifications keep long-running analysis from overwhelming the editor
- [Node.js Runtime Architecture](nodejs-runtime.md) — language servers are Node.js processes talking over stdio; the event loop drives the message handling
- [Distributed Systems](distributed-systems.md) — an editor and a language server are two processes collaborating over a protocol, with all the usual failure modes

---

## Key Takeaways

> LSP solves the N × M problem of language tooling: editors implement one JSON-RPC client, language authors implement one server, and every combination works. The `initialize` handshake negotiates capabilities so old clients and new servers interoperate. The server owns language understanding (parsing, symbols, types) and pushes diagnostics as notifications, while the editor owns the UI and sends requests for hover, completion, and definition. The reference implementation is TypeScript, so Node.js is the natural host. LSP is the right choice for cross-editor language tooling; for a single editor or pure syntax highlighting, native extensions are simpler.