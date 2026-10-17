# Atlas

A local hub for the decisions, architecture and pivots behind every project on this Mac.

Decide something with Claude Code in any project and Atlas picks it up automatically. It keeps what was decided, why, what was rejected, and how the decision changed later, with a verbatim quote from the session as evidence. The interface is composed by an agent over [AG-UI](https://docs.ag-ui.com), so a view fits its content: a pivot lineage, an architecture diagram, a comparison of options.

## How it works

```
Claude Code session (any project)
  └─ hooks: SessionEnd / PreCompact / Stop ──► atlasd (local daemon, launchd)
                                                 ├─ ingest   transcript → clean turns
                                                 ├─ extract  Claude → entries + evidence,
                                                 │           reconciled into lineage (pivots)
                                                 ├─ store    SQLite + FTS5, markdown mirror
                                                 ├─ mcp      ask / log decisions from any session
                                                 └─ agui     streams generative views
                                                        │
                                       Atlas.app (Tauri) ◄┘
```

## Status

| Milestone | Scope                                       | State |
| --------- | ------------------------------------------- | ----- |
| M0        | Repo, tooling, schemas, ADRs                | ✅    |
| M1        | Transcript ingestion, hooks, backfill       |       |
| M2        | Extraction, evidence checks, lineage, evals |       |
| M3        | MCP server                                  |       |
| M4        | Desktop app, deterministic views            |       |
| M5        | Generative canvas (⌘K) over AG-UI           |       |
| M6        | Installer, onboarding, polish               |       |

## Development

```sh
pnpm install
pnpm check
```

Requires Node 22, pnpm 12 and Rust stable. Design decisions: [`docs/decisions/`](docs/decisions/).
