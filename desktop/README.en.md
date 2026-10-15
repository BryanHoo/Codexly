<p align="center">
  <img src="./public/brand/codexly-mark.svg" alt="Codexly" width="88" />
</p>

<h1 align="center">Codexly</h1>

<p align="center">
  A local-first desktop AI coding workspace.
</p>

<p align="center">
  <a href="#features">Features</a>
  ·
  <a href="#quick-start">Quick Start</a>
  ·
  <a href="./docs/installation.en.md">Install & Uninstall</a>
  ·
  <a href="./README.md">简体中文</a>
  ·
  <a href="./LICENSE">License</a>
</p>

Codexly brings AI coding tasks, conversations, approvals, project files, and Git actions into one desktop workspace for sustained work on real projects without switching between multiple tools.

## Features

- Run project or temporary tasks and follow responses, commands, plans, approvals, and file changes in real time
- Load recent conversation history first, fetch older turns from the top, and load execution details independently when expanding a process; long code previews share bounded highlighting with the Web edition
- Follow task output in a separate transparent window without occupying the main workspace
- Keep follow-up work in a persistent task queue, then withdraw messages for editing, reorder them, or cancel them before they run
- Attach files, images, and audio, reference project files with `@` and Skills with `$` in the plain-text composer, and reliably restore attachments from the task queue
- Install and manage Skills, official plugins, and third-party markets in the extension center, including MCP service controls and hot reload; refresh official plugins to synchronize their state and report partial failures
- Answer asynchronous questions in a pinned panel, prevent concurrent interactions with cross-client task locks, and restore thread model and reasoning settings
- Open up to four task panes with independent drafts and message queues; project files, Git panels, and the terminal follow the focused task
- Choose two, three, or four panes from **Split layout** in the task title bar, with auto fit, columns, rows, main-pane, or grid presets; keep the current chat and open new-task pages in the other panes.
- Resize panes by dragging dividers, create tasks from the title bar, and see the current model and reasoning effort while the composer is collapsed
- Edit project text files directly in the source preview with undo, redo, manual saving, and automatic saving on blur
- Follow streaming reasoning summaries and grouped operations, and inspect runtime warnings and live tool timing in the context panel and timeline
- Read incrementally rendered Markdown responses, zoom and pan message images, project images, and wallpapers, then fit them to the window or view them at their original size
- Preview PDFs directly from chat attachments, file links, and the project file tree with access granted to individual local files
- View task-local images embedded in Markdown responses and open them in the image preview
- Run commands in the project-native integrated terminal and switch between persistent sessions
- Use global shortcuts to create tasks, switch workspace areas, and perform common actions
- Create scheduled tasks with visual recurrence rules for weekdays, weekends, weekly, or monthly schedules, then preview upcoming runs
- Request background compression of history not written for more than 7 days under Settings → Agent Configuration → History File Storage; other Codex clients sharing the history directory must support the compressed format
- Automatically install and verify an app-private Codex `0.162.0` runtime without requiring a global Codex setup
- Follow file citations, code review comments, and follow-up suggestions in assistant responses; selecting a suggestion fills the composer for editing
- Choose the model, reasoning effort, Fast mode, approval behavior, and file access for each task, and configure the global model context window
- Discover models from custom providers online and fall back to a local catalog when unavailable
- Create projects and directories, manage multiple project roots, temporary tasks, and archived tasks, generate titles for new tasks, and fork new tasks from existing conversations
- Switch tasks from the sidebar’s **Pinned** and **Running** shortcuts, with unread completions first, followed by pending approvals and running tasks; unread completions remain in the group count until viewed. Collapse previews or open the full list, even with projects collapsed.
- Identify tasks from different projects through project labels in the sidebar; collapsed projects still show unread completions, pending approvals, or running tasks
- Search tasks, message history, and project files across projects, then jump to exact history matches
- Browse and manage project files, switch between file previews and diffs in the inspector, review uncommitted changes and commit history, then copy messages as source-preserving Markdown
- Create or switch Git branches and worktrees, start worktree tasks in the original project, then commit selected files, commit and push, or push existing commits independently; Git actions require a repository at the project root, and ordinary subdirectories do not use the parent repository
- Enable launch at system login in Settings → General on Windows, Ubuntu, or macOS
- Use Simplified Chinese or English, system notifications, minimize to tray, and workspace pets

## Quick Start

1. Download a package from [Releases](https://github.com/BryanHoo/Codexly/releases) and follow the [installation guide](./docs/installation.en.md).
2. Launch Codexly and let it install and verify its private Codex runtime.
3. Add a project or create a temporary task to begin.

Supports Windows, Ubuntu, and macOS. See the installation guide for architecture, minimum system versions, and Modern / Legacy package selection.

## Usage

For repository work, add one or more local directories as project roots, create a task, and submit your request. Create a temporary task when no project context is required. Messages can include files, images, project references, and Skills.

Open a task in another pane from its sidebar menu, or right-click a blank area in the chat to split up, down, left, or right, up to four panes. Use `⌘+⌥+Arrow` on macOS or `Ctrl+Alt+Arrow` on Windows / Ubuntu. Focus a pane to switch the project files, Git panels, and terminal to its task.

While a task is running, send additional guidance immediately or queue follow-up messages. Task controls configure the model, reasoning effort, Fast mode, approval behavior, and file access.

Drag a divider to resize adjacent panes. Navigation from notifications, search, or scheduled tasks preserves the split layout and focuses the target task.

Open a project text file in the source preview to edit it; switch Markdown to source mode first. Changes save when the editor loses focus, you leave the file, or you switch windows; use `⌘/Ctrl+S` to save manually. UTF-8 files up to 2 MiB are editable, with line endings and BOM preserved; larger or unsupported files stay read-only. Save errors and conflicts keep your draft in the current window and show recovery actions. Closing a panel or exiting the app protects unsaved edits. Drafts are held in memory and are not guaranteed to survive a forced exit or crash.

The workspace provides project files, code changes, Git history, branches, worktrees, reviews, commits, and push actions. The Changes toolbar shows the branch, push destination, and incoming/outgoing counts, with remote configuration, branch publishing, fetch, fast-forward pull, and independent push actions. The footer edits the commit message; the main button commits and **More Git actions** offers **Commit and push**. Drafts persist on the current device by project, worktree, and branch; AI generation can be undone. A failed push preserves the local commit for retry. **Publish branch** establishes upstream tracking; see the [Git workflow guide](../docs/git-workflow.md). Archived tasks can be restored or permanently deleted after confirmation.

## Documentation

- [Installation, updates, and uninstall](./docs/installation.en.md)
- [Development and builds](./docs/development.en.md)
- [macOS build profiles](./docs/macos-build-profiles.md)
- [Release guide](./docs/releasing.md)
- [Changelog](../CHANGELOG.md)
- [Conversation loading and performance](../docs/conversation-performance.md)
- [Commit and push](../docs/git-workflow.md)
- [Model context window](../docs/model-context-window.md)

## Help

- [Report an issue](https://github.com/BryanHoo/Codexly/issues)
- [Releases](https://github.com/BryanHoo/Codexly/releases)

## License

[MIT](LICENSE)
