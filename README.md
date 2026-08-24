# CodeAgent

English | [简体中文](README.zh-CN.md)

CodeAgent is a local AI coding workspace for using Codex in a browser. It organizes work by project, streams Codex activity, and provides file, code review, and Git tools while the host computer remains the source of its project filesystem.

## Features

- Run project or temporary Codex tasks and follow responses, commands, and file changes in real time
- Attach files and images, reference project files with `@`, and answer input requests from configured MCP servers
- Choose the model, reasoning effort, Fast mode, approval behavior, and file access level for each task
- Organize ordered multi-root projects, archive completed tasks, and permanently delete tasks when needed
- Inspect files and diffs, review code, manage branches and worktrees, and commit or push changes
- Fork a task from an AI response and continue it in a new Git worktree
- Access the workspace from another device on a trusted local network

## Requirements

- Node.js 22.14.0 or later
- Chrome/Chromium 116+, Firefox 124+, or Safari 17.4+

CodeAgent includes a supported Codex CLI through `@openai/codex`; a separate installation is not required. Use `--codex-bin <path>` or `CODE_AGENT_CODEX_BIN` only when you need another executable.

## Quick Start

Run the latest version without installing it:

```bash
npx --package @bryanhu/code-agent@latest code-agent start
```

CodeAgent opens the browser automatically. If it does not, use the address printed in the terminal; the default is `http://127.0.0.1:3210`. Keep the terminal running and press `Ctrl+C` to stop.

On first launch, sign in with ChatGPT or configure an OpenAI-compatible service that supports the Responses API and `GET /models`.

For regular use, install CodeAgent globally:

```bash
npm install --global @bryanhu/code-agent
code-agent start
```

## Usage

Select **New task** for work that does not need a project. For repository work, add one or more host directories as ordered project roots, create a task, and submit your request with any required files, images, project references, or Skills. Archived tasks can be restored or permanently deleted from the project task list.

Task controls set the model, reasoning, Fast mode, approval, and file access behavior. Notification preferences and the last complete project settings are saved for later tasks. The right inspector provides project files, sources, code changes, Git history, review, and commit actions. Project directories and files always come from the computer running CodeAgent, including when the UI is opened on another device.

## Local Network Access

Start trusted LAN access with:

```bash
code-agent start --lan
```

The terminal prints the LAN address and a random access password. Common options are:

| Option                      | Purpose                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `--port <port>`             | Choose the starting port; occupied ports are skipped automatically                         |
| `--lan-password <password>` | Set a 16-128 character password containing uppercase, lowercase, number, and symbol        |
| `--allowed-host <domain>`   | Allow an exact reverse proxy domain; repeat the option for multiple domains                |
| `--session-ttl <duration>`  | Set a fixed LAN session lifetime such as `12h`; omitted sessions last until server restart |

Quote passwords containing shell-special characters. LAN mode uses unencrypted HTTP, so use it only on a trusted network and never expose it directly to the internet. Restarting CodeAgent invalidates the password and all sessions.

## Diagnostics and Updates

Run `code-agent doctor` when startup, Codex, or local data checks fail. Run `code-agent --help` for the current command and option reference.

Interactive startup and **Settings > About** check for new releases. A global installation can also be updated with:

```bash
npm install --global @bryanhu/code-agent@latest
```

## Help

- [Report an issue](https://github.com/BryanHoo/CodeAgent/issues)
- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE)
