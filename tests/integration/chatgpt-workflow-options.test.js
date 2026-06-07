import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const root = process.cwd();
const workflowPath = path.join(root, ".github/workflows/pake-cli.yaml");
const workflow = fs.readFileSync(workflowPath, "utf8");

describe("ChatGPT workflow build options", () => {
  it("exposes activation shortcut and inject inputs", () => {
    expect(workflow).toContain("activation_shortcut:");
    expect(workflow).toContain("Inject CSS/JS files");
    expect(workflow).toContain("auto_start:");
  });

  it("passes activation shortcut and inject options in bash builds", () => {
    expect(workflow).toContain(
      'ARGS+=("--activation-shortcut" "${{ inputs.activation_shortcut }}")',
    );
    expect(workflow).toContain('ARGS+=("--inject" "${{ inputs.inject }}")');
    expect(workflow).toContain('ARGS+=("--auto-start")');
  });

  it("passes activation shortcut and inject options in Windows builds", () => {
    expect(workflow).toContain(
      '$args += "--activation-shortcut", "${{ inputs.activation_shortcut }}"',
    );
    expect(workflow).toContain('$args += "--inject", "${{ inputs.inject }}"');
    expect(workflow).toContain('$args += "--auto-start"');
  });

  it("contains the ChatGPT icon and inject script assets used by the workflow", () => {
    expect(fs.existsSync(path.join(root, "assets/ChatGPTICON.png"))).toBe(true);
    expect(fs.existsSync(path.join(root, "assets/script.js"))).toBe(true);
  });
});
