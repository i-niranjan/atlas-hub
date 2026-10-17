import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export interface ResolvedProject {
  name: string;
  rootPath: string;
  gitRemote: string | null;
}

/** Walk up from `cwd` to the nearest git root; fall back to `cwd` itself. */
export function resolveProject(cwd: string): ResolvedProject {
  let dir = cwd;
  for (;;) {
    if (existsSync(join(dir, ".git"))) {
      return { name: basename(dir), rootPath: dir, gitRemote: readGitRemote(dir) };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { name: basename(cwd) || cwd, rootPath: cwd, gitRemote: null };
}

function readGitRemote(root: string): string | null {
  try {
    const gitPath = join(root, ".git");
    // Worktrees have a .git file pointing elsewhere; the remote lives in the main repo.
    if (!statSync(gitPath).isDirectory()) return null;
    const config = readFileSync(join(gitPath, "config"), "utf8");
    const m = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(config);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
