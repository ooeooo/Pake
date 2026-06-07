# ChatGPT Client Workflow Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Pake 的手动 GitHub Workflow 能用指定图标、热键和注入脚本构建 ChatGPT macOS DMG。

**Architecture:** 保持功能在 CLI 与 workflow 的现有边界内完成。CLI 已支持热键和注入文件，改动集中在 workflow 输入透传与仓库资产路径，避免改动 Rust 默认行为。

**Tech Stack:** GitHub Actions YAML、Node.js/Vitest、Pake CLI、Tauri。

---

### Task 1: 添加 workflow 红灯测试

**Files:**

- Create: `tests/integration/chatgpt-workflow-options.test.js`

- [ ] **Step 1: 写失败测试**

```js
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
  });

  it("passes activation shortcut and inject options in bash builds", () => {
    expect(workflow).toContain(
      'ARGS+=("--activation-shortcut" "${{ inputs.activation_shortcut }}")',
    );
    expect(workflow).toContain('ARGS+=("--inject" "${{ inputs.inject }}")');
  });

  it("passes activation shortcut and inject options in Windows builds", () => {
    expect(workflow).toContain(
      '$args += "--activation-shortcut", "${{ inputs.activation_shortcut }}"',
    );
    expect(workflow).toContain('$args += "--inject", "${{ inputs.inject }}"');
  });

  it("contains the ChatGPT icon and inject script assets used by the workflow", () => {
    expect(fs.existsSync(path.join(root, "assets/ChatGPTICON.png"))).toBe(true);
    expect(fs.existsSync(path.join(root, "assets/script.js"))).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `corepack pnpm exec vitest run tests/integration/chatgpt-workflow-options.test.js`

Expected: FAIL，原因是 workflow 还没有新输入，且 `assets/ChatGPTICON.png` 还不存在。

### Task 2: 实现 workflow 透传和图标资产

**Files:**

- Modify: `.github/workflows/pake-cli.yaml`
- Create: `assets/ChatGPTICON.png`

- [ ] **Step 1: 复制图标**

Run: `cp assets/chatgpt-icon.png assets/ChatGPTICON.png`

- [ ] **Step 2: 修改 workflow 输入**

在 `targets` 输入之后加入：

```yaml
activation_shortcut:
  description: "Global shortcut to toggle app visibility"
  required: false
  default: ""
inject:
  description: "Inject CSS/JS files"
  required: false
  default: ""
```

- [ ] **Step 3: 修改 Linux/macOS bash 构建命令**

在 `hide_title_bar` 判断后追加：

```bash
          if [ -n "${{ inputs.activation_shortcut }}" ]; then
            ARGS+=("--activation-shortcut" "${{ inputs.activation_shortcut }}")
          fi

          if [ -n "${{ inputs.inject }}" ]; then
            ARGS+=("--inject" "${{ inputs.inject }}")
          fi
```

- [ ] **Step 4: 修改 Windows PowerShell 构建命令**

在 `hide_title_bar` 判断后追加：

```pwsh
          if ("${{ inputs.activation_shortcut }}" -ne "") {
            $args += "--activation-shortcut", "${{ inputs.activation_shortcut }}"
          }

          if ("${{ inputs.inject }}" -ne "") {
            $args += "--inject", "${{ inputs.inject }}"
          }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `corepack pnpm exec vitest run tests/integration/chatgpt-workflow-options.test.js`

Expected: PASS。

### Task 3: 验证、提交、推送和触发构建

**Files:**

- Modify: `.github/workflows/pake-cli.yaml`
- Create: `assets/ChatGPTICON.png`
- Create: `tests/integration/chatgpt-workflow-options.test.js`
- Create: `docs/superpowers/specs/2026-06-07-chatgpt-client-workflow-build-design.md`
- Create: `docs/superpowers/plans/2026-06-07-chatgpt-client-workflow-build.md`

- [ ] **Step 1: 运行相关测试**

Run: `corepack pnpm exec vitest run tests/integration/chatgpt-workflow-options.test.js tests/integration/workflow-paths.test.js`

Expected: PASS。

- [ ] **Step 2: 格式检查**

Run: `corepack pnpm exec prettier --check .github/workflows/pake-cli.yaml tests/integration/chatgpt-workflow-options.test.js docs/superpowers/specs/2026-06-07-chatgpt-client-workflow-build-design.md docs/superpowers/plans/2026-06-07-chatgpt-client-workflow-build.md`

Expected: PASS。

- [ ] **Step 3: 提交**

Run:

```bash
git add .github/workflows/pake-cli.yaml assets/ChatGPTICON.png assets/chatgpt-icon.png assets/script.js tests/integration/chatgpt-workflow-options.test.js docs/superpowers/specs/2026-06-07-chatgpt-client-workflow-build-design.md docs/superpowers/plans/2026-06-07-chatgpt-client-workflow-build.md
git commit -m "ci: add ChatGPT workflow build options"
```

- [ ] **Step 4: 推送分支**

Run: `git push -u origin chatgpt-client-workflow-build`

- [ ] **Step 5: 触发 GitHub Workflow**

Run:

```bash
gh workflow run pake-cli.yaml \
  --ref chatgpt-client-workflow-build \
  -f platform=macos-latest \
  -f url=https://chatgpt.com/ \
  -f name=ChatGPT \
  -f icon=assets/ChatGPTICON.png \
  -f width=1200 \
  -f height=780 \
  -f fullscreen=false \
  -f hide_title_bar=true \
  -f multi_arch=false \
  -f targets=deb \
  -f activation_shortcut=Ctrl+Cmd+C \
  -f inject=assets/script.js
```

- [ ] **Step 6: 下载 DMG**

Run:

```bash
gh run list --workflow pake-cli.yaml --branch chatgpt-client-workflow-build --limit 1
gh run watch <run-id> --exit-status
mkdir -p artifacts/chatgpt
gh run download <run-id> --name ChatGPT-macOS --dir artifacts/chatgpt
```

Expected: `artifacts/chatgpt/ChatGPT.dmg` 存在。
