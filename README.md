# Atlas

A local hub for the decisions, architecture and pivots behind every project on this Mac.

Decide something with Claude Code in any project and Atlas picks it up automatically. It keeps what was decided, why, what was rejected, and how the decision changed later, with a verbatim quote from the session as evidence. Ask it questions with ⌘K: an agent composes the answer from recorded entries over [AG-UI](https://docs.ag-ui.com), so a view fits its content, whether that's a pivot lineage, an architecture diagram or a comparison of options.

## How it works

```
Claude Code session (any project)
  └─ hooks: SessionEnd / PreCompact / Stop ──► atlasd (local daemon, launchd, :47600)
                                                 ├─ ingest   transcript → user, assistant and choice turns
                                                 ├─ extract  Claude → entries + verbatim evidence,
                                                 │           reconciled into lineage (pivots)
                                                 ├─ store    SQLite + FTS5, markdown mirror in ~/Atlas
                                                 ├─ mcp      ask / check / log decisions from any session
                                                 └─ agui     streams agent-composed views
                                                        │
                                       Atlas.app (Tauri) ◄┘
```

Quality rules: an entry is saved only with a quote that is mechanically verified against the transcript. Decisions the assistant made without the developer agreeing land in **Needs Review**. Generated views reference entries by id, and their content always comes from the store (ADR 0010).

## Install

```sh
pnpm install
node packages/daemon/src/cli.ts install   # hooks, launchd agent, MCP registration
node packages/daemon/src/cli.ts doctor    # verify
pnpm --filter @atlas/desktop app:build    # → apps/desktop/src-tauri/target/release/bundle/macos/Atlas.app
```

Then open Atlas → Settings (⌘,) and add an Anthropic API key. It is stored in the Keychain. Sessions captured before the key existed are processed as soon as you add it.

`node packages/daemon/src/cli.ts uninstall` removes the hooks, the launchd agent and the MCP registration, and keeps your data.

## Using it

| Where                          | What                                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Atlas.app                      | Projects in the sidebar; timeline of entries; inspector with rationale, alternatives, evidence and history. ⌘K asks, ⌘F searches, ⌘⇧R opens Needs Review, ⌘↩ / ⌘⌫ confirm or dismiss. |
| Any Claude Code session        | MCP tools `atlas_why`, `atlas_check`, `atlas_decisions`, `atlas_search`, `atlas_log_decision`.                                                                                        |
| A project's `docs/decisions/`  | Decision records in Atlas's format are imported automatically (this repo's own included).                                                                                             |
| `~/Atlas/<project>/decisions/` | Markdown copy of every extracted entry.                                                                                                                                               |

## Status

| Milestone | Scope                                        | State                                |
| --------- | -------------------------------------------- | ------------------------------------ |
| M0        | Repo, tooling, schemas, ADRs                 | ✅                                   |
| M1        | Transcript ingestion, hooks, spool, backfill | ✅                                   |
| M2        | Extraction, evidence checks, lineage         | ✅ (golden evals pending an API key) |
| M3        | MCP server                                   | ✅                                   |
| M4        | Desktop app, deterministic views             | ✅                                   |
| M5        | Generative canvas (⌘K) over AG-UI            | ✅                                   |
| M6        | Installer, doctor, release build             | ✅                                   |

## Development

```sh
pnpm check                                     # typecheck, lint, format, tests
node --watch packages/daemon/src/cli.ts serve  # daemon (stop the launchd one first)
pnpm --filter @atlas/desktop app:dev           # app with hot reload
```

Requires Node 22, pnpm 12 and Rust stable. Design decisions: [`docs/decisions/`](docs/decisions/).
