# Atlas

A local macOS hub that captures the decisions, architecture and pivots made in Claude Code sessions across every project, and shows them through an agent-composed (AG-UI) interface. The plan lives in the README. Decisions live in `docs/decisions/`.

## Layout

- `packages/core`: shared zod schemas (`Entry`, `Project`, `Session`). Every other package depends on these. Change them deliberately.
- `packages/daemon`: `atlasd` (ingest, extract, store, AG-UI endpoint, MCP server, CLI). _(M1+)_
- `packages/hook`: dependency-free `atlas-hook` script for Claude Code hooks. _(M1)_
- `packages/ui`: design system shared by deterministic and generative views. _(M4)_
- `apps/desktop`: Tauri 2 + React app. _(M4)_

## Commands

```sh
pnpm install
pnpm check        # typecheck + lint + format check + tests; run before every commit
pnpm test         # vitest
```

Toolchain: Node 22 (`/opt/homebrew/opt/node@22`), pnpm 12, Rust stable via rustup. TypeScript is pinned to 6.0 (see ADR 0009).

## Conventions

- TypeScript ESM, `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`. Relative imports use `.ts` extensions.
- Validate at boundaries with zod (transcripts, LLM output, HTTP bodies, generative UI trees). Trust types inside.
- Tests sit next to code as `*.test.ts`. Extraction prompt changes must keep the golden evals passing.
- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`…), one milestone step per commit.
- Exact dependency versions, no `^`.

## Recording decisions (dogfooding)

When a session makes or changes a design decision for Atlas, add an entry to `docs/decisions/` in the format described in `docs/decisions/README.md`:

- Only record what was explicitly chosen. Quote the transcript verbatim as evidence.
- Agent-made decisions without user agreement get `review: needs_review`.
- Never rewrite an old record. Supersede it with a new one (`kind: pivot`, `supersedes: <id>`) and mark the old one `superseded`.

Once M3 lands, use the Atlas MCP tools (`atlas_log_decision`, `atlas_check`) instead.

## Product quality bar

- macOS-native look and feel: system font, semantic colors, `AccentColor`, HIG type scale, keyboard-first, designed empty, loading and error states.
- No filler in generated or written text: specific nouns, summaries ≤140 chars, every rationale names its trade-off.
- Out of scope (ADR 0008): morning brief, idea inbox.
