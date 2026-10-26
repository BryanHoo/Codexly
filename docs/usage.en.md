# Use the workspace

[Documentation](README.md) · [简体中文](usage.md) · [Getting started](getting-started.en.md)

This guide covers desktop, computer browsers, and mobile browsers. Files, Git operations, and agents run on the computer hosting Codexly. Desktop adds a native terminal, global shortcuts, a separate task window, system notifications, and tray integration.

## Projects and tasks

Open a sidebar task’s **More actions → Export conversation** to save JSON with task information, all historical turns, messages, execution items, and attachment metadata. Earlier history is fetched automatically. Web and mobile browsers download to the current device; the desktop app opens a native save dialog. Attachment binaries are excluded, and exports are limited to 64 MiB. Running tasks include content available while reading; the file is intended for inspection and processing and cannot be imported to restore a conversation.

Add a disk folder as a project, or create a temporary task without project context. Git tools require a repository at the project root; ordinary subdirectories do not borrow a parent repository.

Pin, archive, restore, or permanently delete tasks. Sidebar shortcuts help you move between projects and show unread completions, pending approvals, and running tasks. Use the task board to review work centrally. Search can find projects, tasks, messages, and files; some entry points depend on the enabled engine.

In the archive list, choose all archived tasks, tasks last updated more than 1, 3, 6, or 12 months ago, or tasks updated before a custom date. The cutoff uses midnight in your device's local calendar and excludes the cutoff date itself; the confirmation shows the exact date. Cleanup covers all archived tasks regardless of the current search. Check the scope and export conversations as needed before permanent deletion.

Switch the sidebar between projects and a timeline grouped by Today, Yesterday, the last seven days, and Earlier. Groups can be collapsed. The task board and extensions are in the sidebar header, with schedules in the icon area; settings, notifications, and help are at the bottom. The notification center separates unread and read alerts and supports marking all as read, or deleting all read notifications from the Read tab. Deleting notifications keeps the tasks. Opening a task marks its notifications as read. Asynchronous questions notify you and mark the task as awaiting an answer; answering or closing the question restores its status.

## Conversations and queues

Choose a model and the permission and reasoning options offered by that engine. Attach files or images, reference project files with `@`, and Skills with `$`. Existing tasks keep their original engine.

Save a title and instructions in **Settings → Saved prompts**, choosing global or project scope. Type `/` or `#` in chat to select a prompt by title: it inserts at the cursor, preserves existing text, and does not send automatically. Project prompts override global prompts with the same title. Prompts stay in the current browser or desktop client and do not synchronize with host task data. When space is limited, composer options such as model selection move into a menu.

Follow streaming replies, commands, tools, plans, subagents, and file changes. Respond to approvals and questions in the task. Steer running work or queue follow-ups; queued messages can be reordered, withdrawn for editing, or cancelled before execution. Claude foreground interruption and background-task stopping are separate controls.

Recent history loads first. Load older turns from the top, and expand execution groups for their details. Claude supports forks from completed replies and context compaction through the command menu. Commands and capabilities follow the selected engine.

## Panes and mobile

Desktop and computer browsers support up to four task panes. Use **Split layout** in the task header, a task's sidebar menu, or the blank-chat context menu. Both clients use `Alt+Shift+Arrow` (Option on macOS). Open **Help → Keyboard shortcuts** for available actions on your platform.

Drag dividers to resize panes. Drafts and queues are independent; files, Git, and the desktop terminal follow the focused task. Navigation from notifications, search, or the task board preserves the layout.

Use the drag handle in a task pane header to move it onto another pane to swap their positions; drop feedback identifies the target.

Mobile keeps a single-task view. Switch projects and tasks through the sidebar and open files, changes, or settings as needed. Native desktop terminals and global shortcuts are unavailable. See [mobile connections](web.en.md#mobile-and-lan-access).

## Files and previews

Open source, Markdown, images, and PDFs in center tabs while the project tree stays visible on the right. Diffs, file reviews, and commit details also use center tabs. Select **Chat** to return to the conversation. Images support zoom and pan; attachments keep their dedicated previews.

Drag document tabs to reorder them. Right-click a tab or open the tab actions menu to pin, move, or bulk-close tabs; the menu also works on mobile. Standard bulk-close actions preserve pinned tabs. Edits save before closing, and failed saves keep tabs and drafts open. Chat stays first and cannot be closed.

Use the file toolbar to compare with chat side by side or above, drag the divider to resize, and click the selected comparison button again to focus on the document. The tab bar is hidden when only chat is open. Task navigation returns to chat while keeping open file tabs. Each task pane owns its tabs. Mobile uses a single tab group and closes overlay sidebars when opening a file.

On a phone or another LAN device, download files that cannot be previewed and open them with an app on that device. Choosing the system default from the file tree, chat file links, or search results first shows a download prompt; transfer starts when you select Download. Local Web access and desktop can still open files with applications on the host.

Edit text in source mode; switch Markdown to source first. UTF-8 files up to 2 MiB are editable, preserving line endings and BOM. Other files remain read-only. Edits save on blur, file navigation, or window switching; use `⌘/Ctrl+S` to save manually, with undo and redo available.

Failed saves or external conflicts keep your draft in the current window and offer recovery actions. Drafts are held in memory and may not survive refreshes, forced exits, or crashes. Confirm save status before leaving.

## Git and worktrees

Review changes, select files, and commit locally or commit and push. Push existing commits independently. A failed push preserves the local commit; resolve the connection or authentication problem and retry pushing.

The toolbar supports remote setup, branch publication, fetch, and fast-forward-only pull. Commit drafts are scoped to the device, project, worktree, and branch. Git uses the host computer's identity and credentials, including from mobile.

Choose or create a worktree from the branch menu beneath the composer, then send the first message there. Existing conversations retain their original directory. Dependencies and ignored environment files are not copied automatically. Resolve merge conflicts in an external Git tool. See the bilingual [Git guide](git-workflow.md).

## Scheduled work

Create a schedule with a project, request, engine, model, and repeat rule. Both engines are supported; Claude-only setups select Claude automatically. Changing a schedule's engine affects future runs, not existing conversations.

The host must remain awake with the desktop app or Web server running. An unknown execution outcome pauses further runs: inspect the linked conversation before deleting and recreating the schedule. Cleanup retries do not launch the work again.

## Extensions and settings

Select Codex or Claude in the extension center and manage Skills, MCP, and official plugins within their global or project scope. Available operations differ by engine. Claude can list, enable, disable, and remove existing MCP definitions; add new definitions through native configuration. Start a new conversation after extension changes for complete loading.

Search and filter extensions, then choose global or current-project scope before making changes. Claude supports installing, enabling, disabling, updating, and uninstalling plugins from the official catalog. Its project Skills and MCP lists show that project's configuration only. Codex project MCP entries are read-only. Third-party Skills marketplace entry points have been removed; local Skills remain manageable. MCP toggles show configuration, not live connection status.

Models, reasoning, permissions, and context settings are engine-specific. Defaults apply to new tasks; existing conversations retain their choices. Declaring a context window does not increase a provider's actual capacity. Claude permissions do not provide Codex's OS sandbox, and extension configuration is not copied across engines.

## Usage statistics

Open **Settings → Usage statistics** to filter token totals, active days, trends, and a yearly heatmap by year and engine. Select a date for its top 50 tasks by usage. Dates use UTC; the heatmap scrolls horizontally on mobile. Statistics record newly observed usage without backfilling earlier history and do not represent remaining credits, costs, or official billing. Desktop and Web on the same host share these records.

## Data across clients

Desktop and Web under the same OS user on the same computer share projects, tasks, and history in `~/.codexly`. Mobile reads the Web host's data. Another computer does not automatically synchronize these directories. Shared storage does not imply simultaneous control of the same running agent session.

Browsers connected to one Web server synchronize project todos and asynchronous questions, refreshing after reconnection or returning to the page. Drafts and pane preferences are not guaranteed to synchronize across devices. See the [storage reference (中文)](local-catalog.md).
