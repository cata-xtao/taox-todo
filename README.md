# taox todo

An Obsidian plugin that lets you embed interactive todo lists inside your notes using a ` ```todo ` code block. Tasks are stored as JSON directly in the block — no separate database, everything lives in your markdown.

## Features

- Grouped tasks (groups and sub-groups) with custom colors
- Per-task priority, start date, and completion date
- Drag-and-drop reordering within and across groups
- Inline quick-add (press Enter to keep creating tasks)
- Full-text search across titles and notes
- Tabs: All / Active / Done
- Right-click menu: edit, toggle done, move to another group, delete (with undo)
- Data persisted in the code block itself

## Installation (manual)

1. Build or download the release files: `main.js`, `manifest.json`, `styles.css`.
2. In your vault, create the folder `.obsidian/plugins/taox-todo/`.
3. Copy the three files into that folder.
4. Open Obsidian → **Settings → Community plugins** → turn on **Community plugins** → enable **taox todo**.

## Usage

Insert a `todo` code block in any note:

````markdown
```todo
{
  "groups": [
    { "id": "g_work", "name": "Work", "color": "#3b82f6" },
    { "id": "g_life", "name": "Life", "color": "#10b981" }
  ],
  "tasks": [
    { "id": "t_1", "title": "Draft the spec", "group": "g_work", "priority": "high" },
    { "id": "t_2", "title": "Buy groceries", "group": "g_life", "done": true }
  ]
}
```
````

- Click a task row to edit it.
- Right-click a row for: edit, toggle done, move to another group, delete.
- Drag rows to reorder or move between groups.
- Click **+ 添加任务** at the bottom of a group, type a title, press Enter (keep pressing Enter to add more).
- Use the search box and the **All / Active / Done** tabs in the header to filter.

The JSON is written back to the block automatically on every change, so your tasks are part of the note.

## Build from source

```bash
npm install
npm run build
```

This runs the TypeScript type check and bundles the plugin with esbuild, producing `main.js` and `styles.css` in the project root.

For development with auto-rebuild:

```bash
npm run dev
```
