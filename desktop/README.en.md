<p align="center"><img src="./public/brand/codexly-mark.svg" alt="Codexly" width="88" /></p>

<h1 align="center">Codexly Desktop</h1>

<p align="center">A local AI coding workspace for Codex and Claude on macOS, Windows, and Ubuntu.</p>

[Product overview](../README.en.md) · [Download desktop](https://github.com/BryanHoo/Codexly/releases) · [简体中文](README.md)

![Codexly desktop workspace](../docs/images/codexly-preview.png)

## Get started

1. Download the package for your system and architecture; follow [installation](docs/installation.en.md).
2. Configure Codex, Claude, or both in Settings. Supported existing local configurations can be reused.
3. Add a project folder, create a task, and send your request.

Runtimes are bundled, with no separate Node.js, Bun, or CLI installation. Supported platforms are Windows 10/11 x64, Ubuntu 24.04+ x64, macOS 14.5+ on Apple Silicon / Intel, and a separate Codex-only macOS 12.4+ Intel Legacy build.

For Windows portable builds, extract the entire ZIP and keep the executable, Claude host, and `runtime` directory together. Updates replace the complete directory.

## Desktop workspace

Desktop shares conversations, approvals, queues, files, Git, extensions, and scheduled workflows with Web and mobile. It adds a native project terminal, global shortcuts, a separate task window, system notifications, and tray integration. Enable startup at login in **Settings → General**.

Open up to four task panes with independent drafts and queues. Files, Git, and the terminal follow the focused task. See [first use](../docs/getting-started.en.md) and the [workspace guide](../docs/usage.en.md).

Switch the sidebar between projects and a timeline, or open the notification center for unread alerts. Opening a task marks its notifications as read. Reorder, pin, or bulk-close center file tabs and compare files with chat horizontally or vertically. Settings includes global or project saved prompts, inserted by title with `/` or `#`, and token statistics for both engines; saved prompts stay in the current client.

Use `Alt+Shift+Arrow` to split tasks and **Help → Keyboard shortcuts** to view available shortcuts. Export a diagnostic ZIP from **Settings → About** when troubleshooting.

The extension center manages local Skills, MCP, and official plugins for Codex or Claude, with search, filters, and global or project scope. Available operations follow each engine's capabilities. Start a new conversation after configuration changes for complete loading.

Desktop and Web under the same OS user on the same computer share projects, tasks, and history in `~/.codexly`. Mobile access needs a separate Web server with LAN enabled; the desktop app does not host it. See [Web and mobile](../docs/web.en.md).

## Documentation and help

- [Installation, updates, and uninstall](docs/installation.en.md)
- [Documentation index](../docs/README.md)
- [FAQ (中文)](../docs/faq.md) · [Diagnostics (中文)](docs/diagnostics.md)
- [Development and builds](docs/development.en.md) · [Runtime distribution (中文)](docs/provider-runtime-management.md)
- [Client and engine capabilities (中文)](docs/codexly-capability-matrix.md)
- [Changelog](../CHANGELOG.md) · [Issues](https://github.com/BryanHoo/Codexly/issues)

## License

[MIT](LICENSE)
