# SyncForge

AI-powered collaborative code editor. Real-time multi-user editing (Socket.IO +
Monaco) with a RAG-based coding assistant (Postgres + pgvector + OpenAI).

Learning project. Built phase by phase, concept before code.

---

## Repo layout

This is an **npm workspaces monorepo** — one repo, several independently
compiled packages. Same idea as Maven/Gradle modules or a multi-module Go repo:
each package has its own `package.json` and its own compile step, and one
package can depend on another.

```
packages/
  shared/   the wire contract   — types only, zero dependencies
  core/     the domain logic    — pure functions, zero I/O
  server/   the adapters        — sockets, Postgres, OpenAI
  web/      the browser client  — Monaco + React        (arrives Phase 5)
```

The architecture is **hexagonal / ports-and-adapters**, described in this
project as "functional core, imperative shell":

```
        ┌─────────────────────────────────────┐
        │  server/   (imperative shell)        │
        │  sockets · Postgres · OpenAI · env   │
        │   ┌─────────────────────────────┐    │
        │   │  core/  (functional core)    │   │
        │   │  transform · chunk · rank    │   │
        │   └─────────────────────────────┘    │
        └─────────────────────────────────────┘
                       ▲
              shared/  │  types both sides import
```

---

## What each package is for

### `packages/shared` — the contract

Types that describe anything crossing the network, imported by **both** the
server and the browser client.

The closest backend analogy is a `.proto` file, or a DTO module shared between
two services. The difference is that because client and server are both
TypeScript here, there's no codegen step — they import the *same type
declaration*, so a protocol mismatch is a compile error rather than a runtime
surprise.

Rule: no dependencies, no logic. Types and constants only.

### `packages/core` — the domain logic

Every algorithm that is hard to get right, written as a **pure function**: data
in, data out, no side effects, same input always gives the same output.

Three things eventually live here:

| Function | Purpose | Phase |
|---|---|---|
| `transform()` | reconcile two concurrent edits so all clients converge | 13–15 |
| `chunk()` | split source files into retrievable pieces | 24 |
| `rank()` | order retrieved chunks by relevance | 27 |

**Why the separation matters.** These are the parts that must be correct. Pure
functions can be tested at machine speed — thousands of randomized edit pairs
per second, asserting that all clients converge, with no server running and no
database container. If `transform()` could only execute inside a live socket
handler, the only way to test it would be opening two browser tabs and typing
fast, which finds a small fraction of the bugs.

**The purity rule is compiler-enforced.** `packages/core/tsconfig.json` sets
`"types": []`, so Node's globals do not exist inside this package. Writing
`process.env.X` in `core/` fails the build with *"Cannot find name 'process'"*.
It's not a convention you have to remember at 1am — it's mechanically impossible
to violate.

### `packages/server` — the adapters

Everything stateful and I/O-bound: Socket.IO handlers, room membership, the
Postgres client, the OpenAI client, process startup.

This package should stay **boring**. It receives bytes, calls into `core`, sends
bytes back. Interesting logic appearing here is a signal it belongs in `core`
instead, where it can be tested without infrastructure.

### `packages/web` — the client (Phase 5)

Monaco editor in the browser. Doesn't exist yet.

---

## Build system

`tsc --build` with **project references** — declared in each package's
`tsconfig.json` under `"references"`. TypeScript reads those, works out the
dependency graph (`shared` → `core` → `server`), and compiles in the right
order. It also refuses to compile an import that isn't a declared reference,
which is what stops `core` from ever importing `server`.

```bash
npm install        # install once, from the repo root
npm run build      # compile all packages in dependency order
npm run typecheck  # full rebuild, ignoring cache
npm run clean      # delete all build output
```

Compiled output goes to each package's `dist/`, which is gitignored.

### Notable compiler settings

Set in `tsconfig.base.json`, inherited by every package:

- **`strict`** — the usual bundle of strictness flags.
- **`noUncheckedIndexedAccess`** — `ops[i]` has type `Op | undefined` rather
  than `Op`. Verbose, but an off-by-one in the transform code that silently
  reads `undefined` is exactly what corrupts a shared document.
- **`noEmitOnError`** — without it, `tsc` writes JavaScript into `dist/` even
  when the build failed, leaving runnable-looking output from broken source.
- **`composite`** — required for project references; makes each package emit
  `.d.ts` files so dependents typecheck against built declarations.
