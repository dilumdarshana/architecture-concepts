# CQRS Express Example

A **CQRS (Command Query Responsibility Segregation)** demo using **Node.js, Express, TypeScript, and PostgreSQL**.

It demonstrates:

- Separation of **Command (Write) and Query (Read) models**
- Event-driven **projections** to keep the read database in sync
- Clean architecture with **Controllers → Handlers → Repositories → DB**
- Type-safe **events and in-memory event bus**

---

## Prerequisites

- **Node.js** `24.15.0` (see `.nvmrc`)
- **pnpm** `10.27.0` (the project uses `packageManager` in `package.json`)
- **PostgreSQL** — two databases: write DB and read DB

---

## Setup

```bash
# Install dependencies
pnpm install

# Copy and configure environment
cp .env.example .env
```

Edit `.env` with your PostgreSQL connection strings (see [Configuration](#configuration)).

---

## Configuration

| Variable | Description |
|---|---|
| `WRITE_DB_URL` | PostgreSQL connection string for the write (source-of-truth) database |
| `READ_DB_URL` | PostgreSQL connection string for the read (denormalized) database |
| `PORT` | Server port (default `3000`) |

Example:

```
WRITE_DB_URL=postgres://user:pass@localhost:5432/task_write_db
READ_DB_URL=postgres://user:pass@localhost:5432/task_read_db
PORT=3000
```

---

## Database Schema

### Write DB (`tasks` table — source of truth)

```sql
CREATE TABLE tasks (
  id         UUID PRIMARY KEY,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'OPEN',
  assignee_id TEXT
);
```

Valid statuses: `OPEN`, `IN_PROGRESS`, `DONE`.

### Read DB (`task_view` table — denormalized for reads)

```sql
CREATE TABLE task_view (
  id         UUID PRIMARY KEY,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMP DEFAULT NOW()
);
```

The read DB is populated and kept in sync by **projections** that react to events published by the command handlers.

---

## Project Structure

```
src/
├── server.ts                          # Entry point
├── app.ts                             # App composition (DI wiring)
├── api/
│   ├── task.command.controller.ts     # POST/PATCH routes for commands
│   └── task.query.controller.ts       # GET routes for queries
├── domain/
│   ├── task.entity.ts                 # Task aggregate root
│   ├── task.status.ts                 # TaskStatus type
│   └── task.rules.ts                  # Domain validation rules
├── commands/
│   ├── create-task/
│   │   ├── create-task.command.ts     # CreateTaskCommand DTO
│   │   └── create-task.handler.ts     # CreateTaskHandler logic
│   └── update-task-status/
│       ├── update-task-status.command.ts
│       └── update-task-status.handler.ts
├── queries/
│   └── get-task/
│       ├── get-task.query.ts          # GetTaskQuery DTO
│       └── get-task.handler.ts        # GetTaskHandler logic
├── events/
│   ├── event-bus.ts                   # In-memory pub/sub event bus
│   ├── task-created.event.ts          # Payload: id, title, status, createdAt
│   └── task-status-updated.event.ts   # Payload: taskId, status, updatedAt
├── projections/
│   ├── task-created.projection.ts     # Projects TaskCreatedEvent → read DB
│   └── task-status-updated.projection.ts
└── infrastructure/
    ├── db/
    │   ├── write-db.ts                # (reserved for write pool factory)
    │   └── read-db.ts                 # Read DB pool factory
    └── repositories/
        ├── task-write.repo.ts         # TaskWriteRepository interface
        ├── task-write.repo.pg.ts      # PostgreSQL implementation
        ├── task-read.repo.ts          # (interface placeholder)
        └── task-read.repo.pg.ts       # PostgreSQL implementation + TaskReadModel
```

---

## Events

| Event | Payload | Published By |
|---|---|---|
| `TaskCreatedEvent` | `id`, `title`, `status`, `createdAt` | `CreateTaskHandler` |
| `TaskStatusUpdatedEvent` | `taskId`, `status`, `updatedAt` | `UpdateTaskStatusHandler` |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/commands/tasks` | Create a new task |
| `PATCH` | `/api/commands/tasks/:id/status` | Update task status |
| `GET` | `/api/queries/tasks/:id` | Get a task by ID |

---

## Running

```bash
# Development (with hot reload)
pnpm dev

# Build
pnpm build

# Production
pnpm start
```

A `test.rest` file is included for quick API testing with REST Client (VS Code extension).

---

## Features

- **Commands:** Create and update tasks via dedicated command handlers and write DB.
- **Queries:** Fetch tasks via a dedicated query handler and read DB.
- **Event Bus & Projection:** Automatically updates the read DB whenever a task is created or its status changes.
- **Separate databases:**
  - Write DB → source of truth
  - Read DB → optimized for reads

---

## Command Flow

```mermaid
  sequenceDiagram
    participant Client
    participant Controller as Command Controller
    participant Handler as CreateTaskHandler
    participant WriteRepo
    participant WriteDB
    participant EventBus
    participant Projection
    participant ReadDB

    Client->>Controller: POST /api/commands/tasks
    Controller->>Handler: CreateTaskCommand
    Handler->>WriteRepo: create(task)
    WriteRepo->>WriteDB: INSERT task
    Handler->>EventBus: publish(TaskCreatedEvent)
    EventBus->>Projection: TaskCreatedEvent
    Projection->>ReadDB: INSERT task_view
```

---

## Update Status Flow

```mermaid
  sequenceDiagram
    participant Client
    participant Controller as Command Controller
    participant Handler as UpdateTaskStatusHandler
    participant WriteRepo
    participant WriteDB
    participant EventBus
    participant Projection
    participant ReadDB

    Client->>Controller: PATCH /api/commands/tasks/:id/status
    Controller->>Handler: UpdateTaskStatusCommand
    Handler->>WriteRepo: updateStatus(id, status)
    WriteRepo->>WriteDB: UPDATE task
    Handler->>EventBus: publish(TaskStatusUpdatedEvent)
    EventBus->>Projection: TaskStatusUpdatedEvent
    Projection->>ReadDB: UPDATE task_view
```

---

## Query Flow

```mermaid
  sequenceDiagram
    participant Client
    participant Controller as Query Controller
    participant Handler as GetTaskHandler
    participant ReadRepo
    participant ReadDB

    Client->>Controller: GET /api/queries/tasks/:id
    Controller->>Handler: GetTaskQuery
    Handler->>ReadRepo: findById(id)
    ReadRepo->>ReadDB: SELECT task_view
    ReadDB-->>ReadRepo: task
    ReadRepo-->>Handler: task
    Handler-->>Controller: task
    Controller-->>Client: JSON response
```

---

## Flow Chart

```mermaid
  flowchart LR
    Client[Client / API Consumer]

    subgraph API Layer
        CC[Task Command Controller]
        QC[Task Query Controller]
    end

    subgraph Command Side
        CH[CreateTaskHandler]
        UH[UpdateTaskStatusHandler]
        WR[Task Write Repository]
        WDB[(Write DB\nPostgreSQL)]
    end

    subgraph Events
        EB[Event Bus]
        EVT[TaskCreatedEvent]
        EVT2[TaskStatusUpdatedEvent]
    end

    subgraph Projection
        PRJ[TaskCreatedProjection]
        PRJ2[TaskStatusUpdatedProjection]
    end

    subgraph Query Side
        QRH[GetTaskHandler]
        RR[Task Read Repository]
        RDB[(Read DB\nPostgreSQL)]
    end

    %% Create command flow
    Client -->|POST /api/commands/tasks| CC
    CC --> CH
    CH --> WR
    WR --> WDB
    CH -->|publish| EB
    EB --> EVT
    EVT --> PRJ
    PRJ --> RR
    RR --> RDB

    %% Update status command flow
    Client -->|PATCH /api/commands/tasks/:id/status| CC
    CC --> UH
    UH --> WR
    WR --> WDB
    UH -->|publish| EB
    EB --> EVT2
    EVT2 --> PRJ2
    PRJ2 --> RR
    RR --> RDB

    %% Query flow
    Client -->|GET /api/queries/tasks/:id| QC
    QC --> QRH
    QRH --> RR
    RR --> RDB
```
