import { describe, expect, it } from "vitest";
import { stableNodePath } from "./install.ts";

describe("stableNodePath", () => {
  it("leaves non-Homebrew paths alone", () => {
    expect(stableNodePath("/usr/local/bin/node")).toBe("/usr/local/bin/node");
  });

  it("keeps the Cellar path when no opt symlink exists", () => {
    expect(stableNodePath("/nonexistent/Cellar/node@22/22.1.0/bin/node")).toBe(
      "/nonexistent/Cellar/node@22/22.1.0/bin/node",
    );
  });
});
