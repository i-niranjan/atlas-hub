import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const SERVICE = "co.atlas.anthropic-api-key";
const ACCOUNT = "atlas";

/** The Anthropic API key lives in the login Keychain, never on disk (ADR 0003). */
export const keychain = {
  async get(): Promise<string | null> {
    try {
      const { stdout } = await run("security", [
        "find-generic-password",
        "-s",
        SERVICE,
        "-a",
        ACCOUNT,
        "-w",
      ]);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  },

  async set(key: string): Promise<void> {
    await run("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", ACCOUNT, "-w", key]);
  },

  async remove(): Promise<void> {
    try {
      await run("security", ["delete-generic-password", "-s", SERVICE, "-a", ACCOUNT]);
    } catch {
      // already absent
    }
  },
};
