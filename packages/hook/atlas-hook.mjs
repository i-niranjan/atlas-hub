#!/usr/bin/env node
// Claude Code hook → atlasd. Dependency-free and fast: it must never slow down
// or break a Claude session, so every failure path exits 0. If the daemon is
// unreachable the event is spooled and replayed when atlasd starts.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dataDir =
  process.env.ATLAS_DATA_DIR ?? join(homedir(), "Library", "Application Support", "Atlas");
const port = process.env.ATLAS_PORT ?? "47600";

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function spool(payload) {
  try {
    mkdirSync(dataDir, { recursive: true });
    appendFileSync(join(dataDir, "spool.jsonl"), `${JSON.stringify(payload)}\n`);
  } catch {
    // nothing else we can do without disturbing the session
  }
}

async function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    return;
  }
  if (!input?.session_id || !input?.transcript_path) return;
  const payload = {
    session_id: input.session_id,
    transcript_path: input.transcript_path,
    cwd: input.cwd,
    hook_event_name: input.hook_event_name,
  };

  let token;
  try {
    token = readFileSync(join(dataDir, "token"), "utf8").trim();
  } catch {
    spool(payload);
    return;
  }

  try {
    const res = await fetch(`http://127.0.0.1:${port}/hook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) spool(payload);
  } catch {
    spool(payload);
  }
}

main().finally(() => process.exit(0));
