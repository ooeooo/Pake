# ChatGPT 客户端 Workflow 打包设计

## 目标

通过 GitHub Actions 打包一个 ChatGPT macOS 客户端，并满足以下行为：

- 使用 `Ctrl+Cmd+C` 作为全局快捷键，在隐藏和显示之间切换。
- 明暗主题跟随系统，不强制开启 `--dark-mode`。
- 应用图标使用仓库内 `assets/ChatGPTICON.png`。
- 唤醒窗口时保持现有窗口聚焦逻辑，必要时让网页获得焦点。
- 注入仓库内 `assets/script.js`。
- 推送到 GitHub 后触发 workflow，并下载生成的 DMG。

## 当前项目事实

Pake CLI 已支持 `--activation-shortcut`、`--inject` 和 `--icon`。Rust 端已经将 `activation_shortcut` 注册为全局快捷键，触发后执行窗口 `hide()` 或 `show()`，并在显示时调用 `set_focus()`。窗口主题默认不传 `--dark-mode` 时跟随系统。

现有 `.github/workflows/pake-cli.yaml` 可以手动构建单个平台，但缺少 `activation_shortcut` 与 `inject` workflow 输入，也没有把这两个值透传给 CLI。

## 方案

选择扩展 `.github/workflows/pake-cli.yaml`：

- 增加 `activation_shortcut` 输入，默认空字符串。
- 增加 `inject` 输入，默认空字符串，允许传入一个或多个以逗号分隔的 CSS/JS 文件路径。
- Linux/macOS bash 构建命令在输入非空时追加 `--activation-shortcut` 与 `--inject`。
- Windows PowerShell 构建命令保持同等能力，避免 workflow 行为不一致。
- 复制现有 `assets/chatgpt-icon.png` 为 `assets/ChatGPTICON.png`，作为这次用户要求的图标路径。

触发 workflow 时使用：

- `platform`: `macos-latest`
- `url`: `https://chatgpt.com/`
- `name`: `ChatGPT`
- `icon`: `assets/ChatGPTICON.png`
- `hide_title_bar`: `true`
- `activation_shortcut`: `Ctrl+Cmd+C`
- `inject`: `assets/script.js`
- `multi_arch`: `false`

## 测试

新增 workflow 集成测试，直接读取 `.github/workflows/pake-cli.yaml`，验证：

- workflow 暴露 `activation_shortcut` 与 `inject` 输入。
- Linux/macOS 命令会追加 `--activation-shortcut` 与 `--inject`。
- Windows 命令会追加 `--activation-shortcut` 与 `--inject`。
- `assets/ChatGPTICON.png` 与 `assets/script.js` 存在，保证 GitHub Actions 能读取仓库内相对路径。

## 非目标

- 不改 Pake 默认 `src-tauri/pake.json`，避免影响所有应用。
- 不把 ChatGPT 写死到通用 CLI。
- 不修改 ChatGPT 网站主题逻辑；跟随系统通过 Tauri/WebView 默认主题完成。
