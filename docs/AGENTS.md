# Agent Instructions — Architecture Concepts

When generating content in this folder, follow these rules.

---

## File Naming

- Use lowercase kebab-case: `event-sourcing.md`, `saga-pattern.md`
- Prefix utility/config files with `_` (e.g. `_template.md`)

---

## Template

Every concept **must** follow the structure in [`_template.md`](_template.md).

Required sections in order:

| Section | Required |
|---------|----------|
| `# <Title>` + quote summary | Yes |
| `## What is it?` | Yes |
| `## Problem` | Yes |
| `## Example` | Yes |
| `## Architecture / Flow` | Yes (text diagram or mermaid) |
| `## How it Works` | Yes (numbered steps) |
| `## Advantages` | Yes |
| `## Trade-offs` | Yes |
| `## When to Use` | Yes |
| `## When NOT to Use` | Yes |
| `## Related Concepts` | Yes |
| `## Key Takeaways` | Yes |

---

## Index

Every new file **must** be added to the table in [`README.md`](README.md).

---

## Practical Project

[`practical-project.md`](practical-project.md) is a capstone document that ties all concepts together. When adding or updating any concept file, review and update `practical-project.md` accordingly:

- Add the concept to the **Pattern Map** table if applicable.
- Update or add **flows** that demonstrate the concept in action.
- Update the **Technology Stack** table if new technologies are introduced.
- Ensure all cross-references from `practical-project.md` still resolve correctly.

---

## Cross-Referencing

Before writing a new concept, **read all existing concept files** in this folder. Concepts are interrelated — reuse terminology and add inline links between files.

- In **Related Concepts** sections, use relative markdown links: `[Outbox Pattern](outbox-pattern.md)` instead of plain text.
- When a concept references another existing concept, link to it directly in the text.
- Keep terminology consistent across files (e.g. always use "dual-write problem" the same way).

---

## Style Rules

1. **No emojis** in content files.
2. Use `---` horizontal rules between every section.
3. Code blocks must specify a language (typescript, javascript, text, bash, sql, etc.).
4. Use `>` for one-line summaries and key takeaways.
5. Keep descriptions concise — aim for skimmable, not prose.
6. Prefer tables over bullet lists for structured comparisons.

---

## Node.js Alignment

All concepts **must** include a Node.js / TypeScript example alongside the generic/illustrative example.

- **Keep both**: lead with a simple illustrative example (text diagram, SQL, config), then follow with the Node.js implementation.
- Use **Prisma** or **Kysely** for database operations (prefer Prisma).
- Use **Express** or **Fastify** for HTTP services (prefer Express).
- Use **Bull** or **@nestjs/bull** / **amqplib** for queues (prefer Bull with Redis).
- Use **@prisma/client** for transactional outbox examples.
- Use `$transaction` for atomic DB operations.
- Use `async/await` style throughout.
