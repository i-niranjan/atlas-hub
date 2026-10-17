# Atlas

A local macOS hub that captures the decisions, architecture and pivots made in Claude Code sessions across every project, and shows them through an agent-composed (AG-UI) interface. The plan lives in the README. Decisions live in `docs/decisions/`.

## Layout

- `packages/core`: shared zod schemas (`Entry`, `Project`, `Session`), the generative UI contract (`ui-spec.ts`) and API types. Every other package depends on these. Change them deliberately.
- `packages/daemon`: `atlasd`, run directly by Node 22 type stripping (no build step, so only erasable TS syntax). `ingest/` (transcript parser, ingestor), `extract/` (prompt, LLM call, evidence verification, reconciliation), `store.ts`, `agent.ts` (AG-UI canvas), `mcp.ts`, `server.ts`, `install.ts`, `cli.ts`.
- `packages/hook`: dependency-free `atlas-hook.mjs` that Claude Code runs on SessionEnd, PreCompact and Stop.
- `apps/desktop`: Tauri 2 shell (`src-tauri/`) plus React UI. `components/Blocks.tsx` renders agent-composed views, and the Inspector reuses the same parts.

## Commands

```sh
pnpm install
pnpm check        # typecheck + lint + format check + tests; run before every commit
pnpm test         # vitest
node packages/daemon/src/cli.ts doctor            # is capture healthy?
pnpm --filter @atlas/desktop app:dev              # app with hot reload
```

The installed daemon runs under launchd (`co.atlas.daemon`, logs in `~/Library/Logs/Atlas/atlasd.log`). After changing daemon code, restart it with `launchctl kickstart -k gui/$(id -u)/co.atlas.daemon`.

Toolchain: Node 22 (`/opt/homebrew/opt/node@22`), pnpm 12, Rust stable via rustup. TypeScript is pinned to 6.0 (ADR 0009). App builds pin the macOS 26.5 SDK (ADR 0011).

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

The Atlas MCP server is installed: before changing a design decision, call `atlas_check`, and use `atlas_why` to see why something is the way it is.

## Product quality bar

- macOS-native look and feel: system font, semantic colors, `AccentColor`, HIG type scale, keyboard-first, designed empty, loading and error states.
- No filler in generated or written text: specific nouns, summaries ≤140 chars, every rationale names its trade-off.
- Out of scope (ADR 0008): morning brief, idea inbox.
