---
id: "0007"
kind: architecture
title: Capture through global Claude Code hooks plus MCP, served by a launchd daemon
summary: Hooks pull decisions from every session automatically; MCP lets sessions query or log them; atlasd runs even when the app is closed.
status: active
supersedes: null
date: 2026-10-17
review: confirmed
evidence:
  - session: f905cf1a-b87d-4fbe-b5e3-2e0d7dbf7553
    quote: "so automatically, Hub should get that."
---

## Context

Decisions from any session in any project must reach Atlas without copy-paste, including when the app isn't open.

## Decision

Global `SessionEnd`, `PreCompact` and `Stop` hooks run a dependency-free `atlas-hook` script. It posts `{session_id, transcript_path, cwd, event}` to `atlasd` and never blocks Claude. If the daemon is down, it appends to a spool file. `atlasd` runs as a launchd LaunchAgent and also serves MCP tools (`atlas_search`, `atlas_why`, `atlas_decisions`, `atlas_log_decision`, `atlas_check`).

## Alternatives

- **Polling `~/.claude/projects`**: simpler, but has latency and misses the context of which event fired.
- **Hooks only**: misses deliberate "log this" moments. **MCP only**: relies on remembering to log.

## Consequences

Only Claude Code sessions are captured automatically. Chats on claude.ai and in the desktop app write no local transcripts.
