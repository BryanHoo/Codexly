# Use the workspace

[Documentation](README.md) · [简体中文](usage.md) · [Getting started](getting-started.en.md)

This guide covers desktop, computer browsers, and mobile browsers. Files, Git operations, and agents run on the computer hosting Codexly. Desktop adds a native terminal, global shortcuts, a separate task window, system notifications, and tray integration.

## Projects and tasks

Open a sidebar task’s **More actions → Export conversation** to save JSON with task information, all historical turns, messages, execution items, and attachment metadata. Earlier history is fetched automatically. Web and mobile browsers download to the current device; the desktop app opens a native save dialog. Attachment binaries are excluded, and exports are limited to 64 MiB. Running tasks include content available while reading; the file is intended for inspection and processing and cannot be imported to restore a conversation.

Add a disk folder as a project, or create a temporary task without project context. Git tools require a repository at the project root; ordinary subdirectories do not borrow a parent repository.

Pin, archive, restore, or permanently delete tasks. Sidebar shortcuts help you move between projects and show unread completions, pending approvals, and running tasks. Use the task board to review work centrally. Search can find projects, tasks, messages, and files; some entry points depend on the enabled engine.

In the archive list, choose all archived tasks, tasks last updated more than 1, 3, 6, or 12 months ago, or tasks updated before a custom date. The cutoff uses midnight in your device's local calendar and excludes the cutoff date itself; the confirmation shows the exact date. Cleanup covers all archived tasks regardless of the current search. Check the scope and export conversations as needed before permanent deletion.

Switch the sidebar between projects and a timeline grouped by Today, Yesterday, the last seven days, and Earlier. Groups can be collapsed. The task board and extensions are in the sidebar header, with schedules in the icon area; settings, notifications, and help are at the bottom. The notification center separates unread and read alerts and supports marking all as read, or deleting all read notifications from the Read tab. Deleting notifications keeps the tasks. All tasks visible in foreground panes automatically mark their notifications as read without clicking each pane. A hidden page keeps new alerts unread until it becomes visible again. Asynchronous questions notify you and mark the task as awaiting an answer; answering or closing the question restores its status.

Read notifications and resolved requests remove their corresponding system alerts. Reading an alert does not approve an action or answer a question; other unread alerts for the same task remain. Notification history has automatic retention limits and prioritizes unread items, so use task history for the full record.

## Conversations and queues

Choose a model and the permission and reasoning options offered by that engine. Attach files or images, reference project files with `@`, and Skills with `$`. Existing tasks keep their original engine.

Save a title and instructions in **Settings → Saved prompts**, choosing global or project scope. Type `/` or `#` in chat to select a prompt by title: it inserts at the cursor, preserves existing text, and does not send automatically. Project prompts override global prompts with the same title. Prompts stay in the current browser or desktop client and do not synchronize with host task data. When space is limited, composer options such as model selection move into a menu.

Follow streaming replies, commands, tools, plans, subagents, and file changes. Respond to approvals and questions in the task. Steer running work or queue follow-ups; queued messages can be reordered, withdrawn for editing, or cancelled before execution. Claude foreground interruption and background-task stopping are separate controls.

Approvals, questionnaires, and MCP forms appear above the composer. Switch between questions, select options or enter a custom answer, then submit the current form. Asynchronous questions may leave the task running; answering or closing one affects only that question. Questions from completed turns move into the expandable execution history. A running indicator continues to show progress after answers or follow-up instructions.

Sending a new question positions its start near the top and leaves reading space below. Replies gradually use that space. Background output preserves your position while reading earlier content. In **Settings → General → Editor**, enable **Sticky messages** and **Message navigation anchors** independently. Both default to off and remember the current client’s choice. Sticky summaries return to earlier questions; anchors on the right jump to messages. Turning either off keeps sending and search-result navigation available.

Web citations in replies display their source domain. Hover, click, or focus to preview the title and target address, then use the card’s link to open the source. Tap on mobile; desktop opens links in the system browser. Cards use information already in the reply and do not fetch the source page.

Open subagent details to inspect the initial task, replies, and execution history in an independently scrollable dialog. New output follows to the bottom by default. Scroll up or select text to pause, and return to the bottom to resume. Load earlier process records when needed.

Consecutive commands, tools, image-view operations, and wait activities share a group with up to five summary rows visible when expanded. Scroll within the group for more rows, or open an item's details in a separate dialog for complete parameters and output. File changes retain their diff entry point. Scrolling or opening details pauses following; returning to the bottom resumes it. Later replies collapse groups by default while preserving manual expansion. Completed turns summarize file changes after the reply.

Recent history loads first. Load older turns from the top, and expand execution groups for their details. Claude supports forks from completed replies and context compaction through the command menu. Commands and capabilities follow the selected engine.

## Panes and mobile

Desktop and computer browsers support up to four task panes. Use **Split layout** in the task header, a task's sidebar menu, or the blank-chat context menu. Both clients use `Alt+Shift+Arrow` (Option on macOS). Open **Help → Keyboard shortcuts** for available actions on your platform.

New panes share the available space equally according to the pane count. Drag dividers to resize them. Drafts and queues are independent; files, Git, and the desktop terminal follow the focused task. Navigation from notifications, search, or the task board preserves the layout.

Use the drag handle in a task pane header to move it onto another pane to swap their positions; drop feedback identifies the target.

Mobile keeps a single-task view. Switch projects and tasks through the sidebar and open files, changes, or settings as needed. Native desktop terminals and global shortcuts are unavailable. See [mobile connections](web.en.md#mobile-and-lan-access).

## Files and previews

Open source, Markdown, images, and PDFs in center tabs while the project tree stays visible on the right. Diffs, file reviews, and commit details also use center tabs. Select **Chat** to return to the conversation. Images support zoom and pan; attachments keep their dedicated previews.

Choose **New file** or **New folder** from the project root or folder menu, enter a name, and create it. Names cannot contain path separators or reserved system names; an existing item is never overwritten. File menus also offer rename and delete. Failed operations keep your input for correction and retry. Web and mobile operate on files on the server computer, whose path and file format rules apply.

Drag document tabs to reorder them. Right-click a tab or open the tab actions menu to pin, move, or bulk-close tabs; the menu also works on mobile. Standard bulk-close actions preserve pinned tabs. Closing unsaved files offers Save, Don’t save, or Cancel together for all affected files, including background tabs. Failed saves keep tabs and drafts open. Chat stays first and cannot be closed.

Use the file toolbar to compare with chat side by side or above, drag the divider to resize, and click the selected comparison button again to focus on the document. The tab bar is hidden when only chat is open. Switching tasks within the same project returns to chat while preserving file tabs, pins, and unsaved drafts without saving. Switching to another project closes that pane’s file tabs after one confirmation for unsaved changes; cancelling or a failed save keeps the original task open. Each task pane owns its tabs. Mobile uses a single tab group and closes overlay sidebars when opening a file.

On a phone or another LAN device, download files that cannot be previewed and open them with an app on that device. Choosing the system default from the file tree, chat file links, or search results first shows a download prompt; transfer starts when you select Download. Local Web access and desktop can still open files with applications on the host.

Edit text in source mode; switch Markdown to source first. UTF-8 files up to 2 MiB are editable, preserving line endings and BOM. Other files remain read-only. Unsaved tabs show a dot. Click Save or press `⌘/Ctrl+S` to write changes; blur, file navigation, and window switching do not save automatically. Use undo and redo, `⌘/Ctrl+F` for search and replace, and `Alt+Z` to toggle line wrapping.

Failed saves keep your draft and offer retry. When the disk file changes, compare it with your draft and choose to continue editing, use the disk version, or save your draft. The latter two require confirmation, and another disk change after comparison still prevents overwriting. Pasting text preserves the file’s original LF or CRLF line endings. Drafts are held in memory and may not survive refreshes, forced exits, or crashes. Confirm save status before leaving.

## Git and worktrees

Review changes, select files, and commit locally or commit and push. Push existing commits independently. A failed push preserves the local commit; resolve the connection or authentication problem and retry pushing.

The toolbar supports remote setup, branch publication, fetch, and fast-forward-only pull. Commit drafts are scoped to the device, project, worktree, and branch. Git uses the host computer's identity and credentials, including from mobile.

Choose or create a worktree from the branch menu beneath the composer, then send the first message there. Existing conversations retain their original directory. Dependencies and ignored environment files are not copied automatically. Resolve merge conflicts in an external Git tool. See the bilingual [Git guide](git-workflow.md).

## Scheduled work

Create a schedule with a project, request, engine, model, and repeat rule. Both engines are supported; Claude-only setups select Claude automatically. Changing a schedule's engine affects future runs, not existing conversations.

The host must remain awake with the desktop app or Web server running. An unknown execution outcome pauses further runs: inspect the linked conversation before deleting and recreating the schedule. Cleanup retries do not launch the work again.

## Extensions and settings

On desktop, toggle **Settings → General → Show status bar icon** to control the system status bar or tray icon. It is visible by default, changes immediately, and remembers your choice after restart. Hiding it keeps the app running and preserves minimizing to the tray when closing the window; fully quit the app to stop background work. Web and mobile browsers do not offer this setting.

Select Codex or Claude in the extension center and manage Skills, MCP, and official plugins within their global or project scope. Available operations differ by engine. Claude can list, enable, disable, and remove existing MCP definitions; add new definitions through native configuration. Start a new conversation after extension changes for complete loading.

Search and filter extensions, then choose global or current-project scope before making changes. Claude supports installing, enabling, disabling, updating, and uninstalling plugins from the official catalog. Its project Skills and MCP lists show that project's configuration only. Codex project MCP entries are read-only. Third-party Skills marketplace entry points have been removed; local Skills remain manageable. MCP toggles show configuration, not live connection status.

Models, reasoning, permissions, and context settings are engine-specific. Defaults apply to new tasks; existing conversations retain their choices. Declaring a context window does not increase a provider's actual capacity. Claude permissions do not provide Codex's OS sandbox, and extension configuration is not copied across engines.

## Usage statistics

Open **Settings → Usage statistics** to filter token totals, active days, trends, and a yearly heatmap by year and engine. Select a date for its top 50 tasks by usage. Dates use UTC; the heatmap scrolls horizontally on mobile. Statistics record newly observed usage without backfilling earlier history and do not represent remaining credits, costs, or official billing. Desktop and Web on the same host share these records.

## Data across clients

Desktop and Web under the same OS user on the same computer share projects, tasks, and history in `~/.codexly`. Mobile reads the Web host's data. Another computer does not automatically synchronize these directories. Shared storage does not imply simultaneous control of the same running agent session.

Browsers connected to one Web server synchronize project todos and asynchronous questions, refreshing after reconnection or returning to the page. Drafts and pane preferences are not guaranteed to synchronize across devices. See the [storage reference (中文)](local-catalog.md).
