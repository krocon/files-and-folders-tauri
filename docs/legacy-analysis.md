# Analyse des alten Codes (node-files-and-folders-client/-server)

> Fachliche Grundlage für die Prompts in `prompts/`. Erstellt im Okt. 2026 aus den Quellen von
> https://github.com/krocon/node-files-and-folders-client und https://github.com/krocon/node-files-and-folders-server
> (beide gelesen, nicht nur die READMEs). Englisch belassen, damit Begriffe und Bezeichner 1:1 zum alten Code passen.
>
> **[read]** = direkt aus dem Code, **[inferred]** = Interpretation. Pfade relativ zu den Repo-Wurzeln:
> `C:` = Client (`src/fnf/...`, wenn nicht anders angegeben), `S:` = Server. Prompts verweisen auf die Abschnitte
> (z. B. „legacy §3.1“). Code wird **nicht** übernommen (AngularJS/Node), Verhalten, Formate und Ideen schon.

| Repo | Last commit | Version | License |
|---|---|---|---|
| `node-files-and-folders-client` | 2016-05-01 "0.0.7" | 0.0.7 | `"license": "MIT"` in `package.json`; **no LICENSE file** |
| `node-files-and-folders-server` | 2017-02-26 "folder node_modules deleted" | 0.0.9 (`files-and-folders-server`) | `"license": "MIT"` in `package.json`; **no LICENSE file** |

Author in server `package.json`: Marc Kronberg. Both READMEs only point to the npm package `files-and-folders` (a wrapper, not analysed).

Paths below are relative to the repo roots: `C:` = client (`src/fnf/...` unless stated), `S:` = server.
**[read]** = taken directly from code. **[inferred]** = my interpretation (library semantics, races, consequences).

`C:release/` is a minified gulp build of the same `src/` (template cache + usemin, `C:gulpfile.js`); nothing extra in it.

---

## 1. Architecture

### 1.1 Server (`S:`)
- `S:app.js` → `index.js` → `lib/server.js`: Express + `http` + socket.io 1.7. Serves the client's `release/` folder statically at `/`, and **`S:config/` statically at `/config`** (the client fetches colour schemes from there). Optional `options.auth` middleware. Port: `options.port | app.get('port') | process.env.PORT | 3000` – a **bitwise OR** bug (`S:lib/server.js`); app.js passes 3002 **[read]**.
- Before it listens, `lib/initial/initialload.js` builds a `systemInfo` object (see §7) and stores it in `global.data`.
- `lib/socket/mapper.js` auto-registers every file in `lib/socket/cmd/*.js` as a socket event of the same name. The handler is `require(file)[name]`. If the payload has `.action`, `p.cmd = cmd` is set **[read]**.
- `lib/memcache.factory.js`: an in-memory cache (cache-manager, max 1000 entries, TTL 120 s) of directory listings, keyed by path. File operations invalidate it with `memoryCache.del(dir)`; `delempty` calls `clearAll()`.
- `lib/fileutil.js`: copy/move by shelling out (`cp -r`/`mv` on macOS, `xcopy`/`move /Y` otherwise), with a fallback to fs-extra.
- `lib/emit.callback.js`: helpers that build the UI events `created`, `removed`, `unselect` and `focus`.

### 1.2 Client (`C:`)
AngularJS 1.4.8, ag-Grid 2.3.5, Bootstrap 4 alpha, jQuery, Keypress 2.1.3, socket.io client, farbtastic and dropzone. Single page: `C:src/index.html`. Module list: `C:src/fnf/app.js`.
- **Event bus**: `common/notify.service.js` (`emit`, `$emit` via `$timeout`, `addListener` …). Every action id is a bus key.
- **Global state**: `common/data.service.js` holds `{initial, activePanelIndex, tools, folderHistory, folderLatestAdded, favs, shortcutsconfig, color}`. `tabs` is added by `tab.service.js`; `availableStyles`, `colorname` and `configLoaded` are added later.
- **Central façade**: `main.service.js`. It works out source and target (source = active panel, target = `abs(active-1)`), the rows an action works on, navigation, the tool runner and file-size formatting.
- **Action dispatch**: `action/action.service.js#action(key)`. Built-in ids are handled there; any id starting with `OPEN_` opens a dialog through `dialog/dialog.action.mapping.service.js` (id → template URL).
- **Dialogs**: `dialog/dialog.service.js` compiles a template from `$templateCache` into a Bootstrap modal. While a dialog is open, all main shortcuts are unregistered and only **Ctrl+Enter** is registered: it clicks the element with `fnf-click-on-ctrl-enter`, or the only `.btn-primary`. ESC closes (Bootstrap). Each dialog controller listens on `<ACTION>_ON_SHOW/_ON_SHOWN/_ON_HIDDEN`.
- **Job queue**: `commands/command.service.js` builds action objects. `action/actionqueue.service.js` runs them one at a time. `action/executor.factory.js` sends each one to the server.
- **Panel updates from events**: `filelist/folder.action.service.js` applies `created`/`removed`/`update`/`focus`/`select`/`unselect` to grid rows. Events are batched by `filelist/eventcache.factory.js` (16 ms debounce, flushed at least every 16 s).

### 1.3 Transport (socket.io events, all **[read]**)
Request/response pairs use a request id (`rid` or action `id`) appended to the event name.

| Client emits | Payload | Server replies on | Reply payloads |
|---|---|---|---|
| `initialload` | – | `initialload` | `{error, data: systemInfo}` |
| `dir` | `{path, rid, nocache}` | `dir<rid>` | First `{dir, begin:true, size:<entryCount>, end?}`, then one per entry `{dir, base, ext, size (null for dirs), date (stat.atime), isDir, error?, end?}`. On readdir error: `{dir, end:true, size:0, error}`. |
| `walk` | `{pathes:[abs dirs], rid}` / `{cancelled:true, rid}` | `walk<rid>` | Entry messages (recursive), then `{end:true}` |
| `walksum` | `{dir, rid}` / cancel | `walksum<rid>` | `{size}` per file, then `{end:true}` |
| `walkfolder` | `{dir, rid}` / cancel | `walkfolder<rid>` | One string (absolute dir path) per subfolder, then `{end:true}` |
| `search` | `{filter:{pathes, pattern}, rid}` / cancel | `search<rid>` | Matching entries with `abs:true`, then `{end:true}` |
| `copy`, `move`, `remove`, `mkdir`, `rename`, `delempty` | action `{id, panelIndex, action:'COPY'…, src:{dir,base}, target:{dir,base}, status, bulk, jobId, cmd}` | `<cmd><id>` | `{events:[{event, panelIndex, item:{dir, base, size?, date?, isDir?}}], error}`; `delempty` replies `{end:true, error}` |
| `open` | absolute file path (string) | – | – |
| `shell` | array of command strings | – | – |
| `saveconfig` | `{username, data}` | – | – |
| `disks`, `tree`, `rmdir`, `unlink`, `concat`, `disconnect` | – | – | Unused or broken (§9) |

Cancellation: the client sends the same event with `{cancelled:true, rid}`. The server sets `socket._cancelled['walk'+rid] = true` and loops check it.

---

## 2. Action IDs and default shortcuts

Shortcut strings use Keypress-library syntax (`S:config/shortcut/osx.json` and `S:config/shortcut/windows.json`, quoted in full). **There is no `linux.json`**, so Linux gets no shortcuts at all **[inferred from initialload.js]**. Labels come from `C:action/action.label.mapping.service.js`.

| Action ID | Label | macOS (`osx.json`) | Windows (`windows.json`) |
|---|---|---|---|
| SPACE_PRESSED | – (calculates folder size) | `space` | `space` |
| HOME_PRESSED | – | `home` | `home` |
| END_PRESSED | – | `end` | `end` |
| PAGEUP_PRESSED | – | `pageup` | `pageup` |
| PAGEDOWN_PRESSED | – | `pagedown` | `pagedown` |
| ENTER_PRESSED | – | `enter` | `enter` |
| TOGGLE_SELECTION_CURRENT_ROW | – | `control 0` | `insert` |
| OPEN_GOTO_ANYTHING_DLG | Go to anything... | `control 1` | `control f12` |
| OPEN_COPY_DLG | Copy | `control 5` | `f3`, `alt f5` |
| OPEN_MOVE_DLG | Move | `control 6` | `f6` |
| OPEN_MKDIR_DLG | Create Dir | `control 7` | `f7` |
| OPEN_DELETE_DLG | Delete | `control 8`, `cmd delete` | `f8`, `f9`, `control delete` |
| OPEN_DELETE_EMPTY_FOLDERS_DLG | Delete Empty Folders... | `cmd alt r` | `control alt r` |
| OPEN_CHDIR_DLG | Change Dir... | `control 9` | `alt f10` |
| SELECT_LEFT_PANEL | Left Panel | `alt 1` | `alt 1` |
| SELECT_RIGHT_PANEL | Right Panel | `alt 2` | `alt 2` |
| TOGGLE_PANEL | Toggle Panel | `tab` | `tab` |
| ADD_NEW_TAB | Add Tab | `alt t` | `alt t` |
| REMOVE_TAB | Remove Tab | `shift t` | `shift t` |
| SAVE_CONFIG | Save Config | `control shift s` | `control shift s` |
| OPEN_GROUPFILES_DLG | Group Files... | `alt g` | `alt g` |
| OPEN_FIND_DUBLICATES_DLG | Find Dublicates... | `alt d` | `alt d` |
| OPEN_MULTIRENAME_DLG | Multi Rename... | `alt f6` | `alt f6` |
| OPEN_RENAME_DLG | Rename... | `shift f6` | `shift f6` |
| OPEN_FIND_DLG | Find... | `alt f7` | `alt f7` |
| RELOAD_DIR | Reload... | `control shift f12` | `control shift f12` |
| OPEN_SELECT_DLG | Enhance Selection... | `num_add` | `num_add` |
| SELECT_ALL | Select All | `control num_add`, `cmd alt a` | `control num_add`, `cmd alt a` |
| OPEN_DESELECT_DLG | Reduce Selection... | `num_subtract` | `num_subtract` |
| DESELECT_ALL | Deselect All | `control num_subtract` | `control num_subtract` |
| TOGGLE_SELECTION | Toggle Selection | `num_multiply` | `num_multiply` |
| NAVIGATE_LEVEL_DOWN (= parent dir) | Parent Dir | `shift pageup`, `alt pageup`, `control pageup` | same |
| NAVIGATE_BACK | History Back | `shift pagedown`, `alt pagedown`, `control pagedown` | same |
| DUMMY_ACTION | – | `control enter` | `control enter` |

Actions with **no default shortcut**, reachable only from menus (`C:common/constants.service.js`, `C:src/index.html`): `COPY_2_CLIPBOARD_NAMES`, `COPY_2_CLIPBOARD_NAMES_AS_JSON`, `COPY_2_CLIPBOARD_FULLNAMES`, `COPY_2_CLIPBOARD_FULLNAMES_AS_JSON`, `OPEN_COLORCONFIG_DLG`, `OPEN_JOB_QUEUE_DLG` (footer button), and `OPEN_DROP_DLG` (fires on drag-enter over the panels).
Internal ids: `ENHANCE_SELECTION`/`REDUCE_SELECTION` (payload = regex), `TRIGGER_DIGEST`, `SHOW_POPUP`, `REFRESH_PANEL`.

Default **tool** shortcuts are listed in §7.3. On macOS, `control 0` is bound twice: to TOGGLE_SELECTION_CURRENT_ROW and to the CMD_SHELL tool **[read]**.

Keyboard mechanics (`C:common/app.keyboard.service.js`) **[read]**:
- Combos fire on **key-up**.
- If a combo ends in a plain letter or digit (regex `/ [a-z0-9]+$/`, e.g. `alt t`), it is registered with `prevent_default:false` and `is_exclusive:false`. All other combos prevent the default and are exclusive.

How shortcuts are shown (`C:shortcut/shortcut.service.js`):
- `printShortcut` replaces CMD with ⌘, ENTER/RETURN with ⏎, CONTROL with ⌃, OPTION with ⌥, SHIFT with ⇧, ADD with +, SUBTRACT with -, MULTIPLY with *.
- Each key is wrapped in `<kbd>`.
- Tooltips use the form `Ctrl-Shift-S`.

---

## 3. Dialogs

| Dialog | Template | Fields and behaviour |
|---|---|---|
| **Copy** | `commands/copy/dialog.html`, `copy.action.*` | **Source** (read-only): name of the single item, or "N files". While `walk` counts recursively it becomes "X files, Y folders (size SI)" with a spinner. **Target**: text field, defaulting to the opposite panel's path, with a dropdown of `getPossibleTargetFolders()` = target panel path, favs, target-panel tabs, source-panel tabs and folder history, deduplicated and without the source dir. An **Options** button shows only "TODO Options". The Copy button is enabled once rows exist. One COPY action per row, then REFRESH_PANEL(target). Closing the dialog cancels the walk. |
| **Move** | `commands/move/*` | Same as Copy. For folders, `target.base = ''`. Ends with REFRESH(source) and REFRESH(target). Stores the cursor row index first. |
| **Delete** | `commands/delete/*` | "Selected" summary from the same recursive walk; Delete button. Acts on **selected rows only**, with no fallback to the focused row (unlike copy/move) **[read]**. Deletion is permanent (`fs.remove`); there is no trash. |
| **Make Directory** | `commands/mkdir/*` | Label `<sourceDir>/` plus a name field. The default name is the first selected item's name without extension. Uses `fs.mkdir` (not recursive). The server emits `created` + `focus`, so the new folder gets the cursor. |
| **Rename** | `commands/rename/*` | Current Name (read-only) and New Name (prefilled). Uses the **first selected** row; if nothing is selected it crashes **[inferred]**. Server: `fs.rename`, then `removed` + `created` + `focus`. |
| **Multi Rename** | `commands/multirename/*` | Full-screen; detailed in §3.1. |
| **Group Files** | `commands/groupfiles/*` | Full-screen; detailed in §3.2. |
| **Find** | `commands/find/*` | **Search in** select: the source dir, each selected folder, and "All N selected folders" when more than one is selected (preselected in that case). **Search for**: a JS regex string matched case-sensitively against the **base name** (`base.match(pattern)`). Presets: `.cbr$\|.cbz$`, `.js(.){0,2}$` (labelled ".jsp$"), `.epub$`, and an image-extension list (labelled "."). An invalid regex just logs a warning. Results go into a **new tab "Search N"** (path `search_N`, `tab.fileList`) and stream in, refreshed every 2 s. The tab label blinks while running. The name column shows the full path; the other columns are hidden (`abs` flag, `grid/gridicon.service.js`). Matching folders are listed too. There is no cancel in the UI (`cancelSearch` exists but is never called). |
| **Change Dir** (TC "Directory hotlist/tree" style) | `commands/chdir/*` | Full-screen. Streams **every subfolder of the source dir, recursively** (`walkfolder`), grid refreshed every 2 s. Has a quick-filter text field (double-click clears it) and a spinner that cancels when clicked. Double-click or the "Chdir" button changes the source panel's folder. Closing the dialog cancels the walk. |
| **Delete empty folders** | `commands/deleteemptyfolders/*` | Start folder = source dir (read-only); Delete. Server algorithm in §6. |
| **Go to anything** | `action/gotoanything/*` | Slides in from the left. A uib-typeahead over commands = every mapped shortcut action that has a label (deduplicated by label) plus all tools, filtered by substring, max 12 matches. Execute runs the tool or emits the action id. Actions without a shortcut mapping (e.g. clipboard) are **not** offered **[read]**. |
| **Enhance selection** (`+`) | `commands/select/selectdialog.html` | Regex input (default `.`) with presets `.cbr$\|.cbz$`, `.jsp`, `.epub`, `.`. Selects every **filtered-visible** row whose base matches. |
| **Reduce selection** (`-`) | `deselectdialog.html` | Same idea; presets `.jsp$`, `.epub$`, `.`; deselects matches. |
| **Job Queue** | `action/jobqueue/*` | Full-screen grid with columns id (sorted desc), Job, Status (icon), Action, Source, Target, refreshed every ~1.2 s. Shows **Restart Queue** when the queue is in ERROR; Close. |
| **Color Config** | `config/color/*` | One text input per CSS variable (32 keys, §8) with a farbtastic colour picker in a popover. Changes apply live to `document.documentElement`. The text colour is the complementary hex. There is **no save**; only Cancel **[read]**. |
| **Find duplicates** | `commands/finddublicates/dialog.html` | Placeholder ("Content..."). Its menu entry is commented out. |
| **Drop** | `drop/*` | "Drop (not implemented yet)". A dropzone receives a browser `FileList`; the app only logs it (`C:app.controller.js`, "TODO ask, yes / no, then upload files"). |
| **Context menu** | `../site/index.html` `#gridPopup`, `grid/grid.popup.controller.js` | Four placeholder "Find..." items. The right-click binding is disabled (`xxxright-click`). |

Bookmarks, tab presets, an attributes dialog, a command line and an options dialog **do not exist**. The only bookmark feature is "favs" (§5).

### 3.1 Multi Rename (`multirename.action.service.js`, `multirename.data.service.js`) **[read]**
- **New Name** pattern, default `[N].[E]` (double-click resets it).
  - `[N]` name, `[E]` extension, `[P]` parent dir name.
  - Ranges `[N a-b]` = `substring(a,b)` (0-based, end exclusive), `[N a-]`, `[N -b]`; the same forms exist for `E` and `P`. Written without spaces, e.g. `[N2-5]`. Only the **first** occurrence of each range form is replaced.
  - `[C]` counter = `start + index*step`, zero-padded to *digits*.
  - The help line also mentions `[D]` in a code comment; it is not implemented.
- **Name/extension split**: ext = text after the last `.`; name = everything before it. For a name without a dot, ext becomes the whole name and name becomes empty (`README` → `.README`). Folders are treated the same way (TODO comment) **[inferred bug]**.
- **Capitalize** (applies to the name part only): none, to uppercase, to lowercase, capitalize first letter, capitalize words (`(?:^|\s)\S`), Chicago Manual of Style (John Resig's `titleCaps`).
- **Counter**:
  - Start: 0, 1, 10, 100, 1000, 10000, 100000, 1000000.
  - Step: 1, 5, 10, 20, "50" (value 30, a bug), 100, 1000.
  - Digits: 1–10, default 4. Defaults start=1, step=1.
- **Checkboxes** (name part only, applied in this order before the pattern):
  1. *Fix german umlauts* (ä→ae, Ä→AE, ß→ss, plus accented letters to ASCII, plus legacy codepage bytes).
  2. *Replace risky chars*: drops everything except `[a-zA-Z0-9_ \[\]()\-.]`.
  3. *Space to underscore*.
  4. *Remove parent dir*: removes the first occurrence of the parent folder's name.
- **Search and replace** (master checkbox) with 4 rows. Each row has: checked, `textFrom`, `textTo`, *RegExp*, *only if match* + `ifMatch`. Rules:
  - Runs on the **whole new base name**, after the pattern is applied.
  - Whitespace runs are first normalised to a single space.
  - With RegExp checked, `textFrom` must be written as `/pattern/flags`. Otherwise it is a plain-string replace of the first occurrence.
  - The regex result also collapses `,,` to `,`.
  - `ifMatch` is either `/re/flags` or a substring.
- **Macro dropdown** per row (3 presets in category "Reorder words"): "prename name - title → name, prename - title", "title - prename name → …", "title - lastname, prename.suffix → …", each with its regex, replacement and ifMatch.
- **Preview grid** (columns No, Old Name, Info, New Name), live on every change. Status is `OK` (changed), `Untouched` or `Error`. Error means **duplicate targets within the selection**; there is no check against files already on disk. Sorted by status, then id.
- **Rename** button: one RENAME action per `OK` row. Bug: the REFRESH action is appended after `addActions`, so it never runs **[read]**.

### 3.2 Group Files (`groupfiles.*`) **[read]**
Puts the selected entries into sub-folders and then **Copy** or **Move**s them. The target root is the opposite panel, or the source dir when *Use Source Dir* is checked. Each item's target = `<root>/<group>/<base>`.

Options: *Ignore Brackets* (default on) removes `[...]` and `(...)` first. *Minimal group size*: none, 2 (default), 3, 4, 5, 10. Shows the number of groups found. OK is enabled when groupCount > 0.

| Mode | How the group name is derived |
|---|---|
| Running number (default) | The name must contain ≥1 digit run and ≥2 non-digit runs. Group = the first non-digit run, minus `#`, `" Band "` and `'`, trimmed of `. _-` and spaces. Min-size filter applies. |
| New folder (manually) | A single user-entered folder name for all items. |
| Minus separator | Greedy `(.+) - (.+)` → part before the **last** " - ", else before the last "-", then trimmed. Min size applies. |
| First word | `(\w+)\W(.+)` → first ASCII word. Min size applies. |
| First letter / … lowercase / … uppercase | First character after trimming. Bracket removal here only matches `[\w\d\s]` contents. No min size. |
| Two letters / lowercase / uppercase | First 2 characters, same rules as above. |

---

## 4. File list behaviour (`grid/gridoptions.factory.js`, `grid/gridicon.service.js`)

- **Columns**:
  - **Name** (`base`, 430 px, default sort asc). Folders are shown as `[name]` with a folder icon; files are shown without the extension, with an icon picked by extension (doc/docx, epub/rtf/txt, pdf, video, ppt, xls, bmp/gif/jpg, js/java/json, zip/"rarp"/7z, mp3/wav).
  - **Ext** (80 px; empty for folders).
  - **Size** (110 px, right-aligned). `toLocaleString('en-US')` with thousands separators; folders show `<DIR>`; unknown `?`; placeholder rows `-`.
  - **Date** (180 px). `stat.atime` (**access time**, not mtime) rendered as `YYYY-MM-DD HH:MM`.
  - Row height 28; columns are resizable. ag-Grid column filters are enabled (`enableFilter`).
- **".." entry**: there is none. Parent navigation uses NAVIGATE_LEVEL_DOWN (Ctrl/Alt/Shift+PgUp) or a click on a breadcrumb segment of the path label (`gui/pathlabel`).
- **Hidden files**: no handling. Every `readdir` entry is shown, dotfiles included. EPERM entries are greyed out.
- **"Smart" sorting** (comparators; the ag-Grid inversion behaviour is **[inferred]**: ag-Grid multiplies the result by −1 for descending and passes `isInverted`):
  - *Name*:
    - Missing values sort last (`return f`).
    - Folders come before files in **both** directions (`-f`, which cancels the inversion).
    - Otherwise `toUpperCase().localeCompare()`, i.e. case-insensitive, locale-aware, **not natural/numeric**.
  - *Size*:
    - A falsy value (folders with an uncalculated size, and 0-byte files) is checked first and sorts **last** in both directions.
    - Folders with a calculated size come first, ordered by name.
    - Files are compared numerically.
  - *Ext/Date*: default ag-Grid comparison (date = ISO string, so chronological).
- **Selection model**:
  - ag-Grid `rowSelection:'multiple'`, `rowDeselection:true`. Click selects; Ctrl-click toggles (ag-Grid default) **[inferred]**.
  - A custom `onRowClicked` adds **Shift-click range selection** from the previously clicked row.
  - Keyboard:
    - Insert (Windows) or Ctrl+0 (macOS) toggles the cursor row and moves the cursor down.
    - Num `*` inverts the selection.
    - Num `+`/`-` open the regex dialogs.
    - Ctrl+Num`+` / Ctrl+Num`-` select or deselect all.
    - **Space does not select**: it calculates the folder size.
    - Select all, invert and the regex dialogs act only on rows that pass the filter (`forEachNodeAfterFilter`).
  - Selected rows are bold and use `--item-selected-color`; on the active panel a check-mark glyph is shown. The cursor row uses `--cursor-row-*`.
  - Selection is kept across incremental updates (`storeSelection`/`restoreSelection` by dir+base).
- **Which rows an action uses**: `getRowsForAction` = selected rows, else the focused row (`main.service.js`). Clipboard and tools use `getSelectedFiles` (**files only**, folders excluded), falling back to the first selected row, then the focused row, then row 0.
- **Cursor keys**:
  - Home/End go to the first/last row.
  - PgUp/PgDn move by (visible body height / row height) − 1.
  - Arrow keys are handled by ag-Grid **[inferred]**.
  - Enter or double-click: a folder is opened in the panel; a file is opened with the OS default app (§6).
- **Quick filter**: a filter icon on each tab bar shows a text input bound to ag-Grid `quickFilterText`, which is a substring match over the cells **[inferred]**. Double-click clears it. It auto-hides after 6.67 s if empty (`gui/filterinput`). There is no type-ahead quick search.
- **Folder size**: Space on the focused folder runs `walksum`, which adds up file sizes recursively into `row.size`. The UI refreshes every 1 s and the size cell is green while the walk runs. There is no cancel in the UI.
- **Status bar** (`gui/filecount/filecount.html`), one per panel: `<sel size> / <total size> in <sel files> / <files> Files, <sel folders> / <folders> Folders`. Bug: sizes are divided by 1000 and then formatted with SI units, so the unit is off by a factor of 1000 **[read]**.
- **Placeholder rows**: copy, move, rename and delete insert or mark rows with `status:'temp'` (muted, size/date `-`) before the server confirms. This is skipped in bulk mode (>30 items).

---

## 5. Panels, tabs, history, persistence

- **Two fixed panels** (`grid/grid.service.js`: two grid models). The active panel is `data.activePanelIndex`. Tab toggles panels. Alt+1 / Alt+2 activate a panel; pressed again on the already-active panel, they **cycle to the next tab** (`tab.service.js#selectPanelAndNextTab`). Clicking a panel activates it.
- **Header per panel**:
  - A breadcrumb path label; each segment is clickable.
  - A star icon: fav/unfav (= bookmark), which saves the config immediately.
  - A folder dropdown button listing `folderLatestAdded` (starting points + up to 15 recent unique folders). Its label is the first path segment (drive letter; empty on Unix – bug).
  - The tab strip, a `+` button and the filter.
- **Tabs**: `data.tabs = [[{path,label,active,fileList?,running?}], [...]]`.
  - **Click** selects a tab (222 ms debounce).
  - **Double-click** removes it (only when more than one tab exists).
  - `+` / ADD_NEW_TAB clones the active tab; REMOVE_TAB closes the active one. Search tabs keep a `fileList` instead of a path.
  - Double-clicking the tab bar background reloads the panel. This clashes with tab double-click.
  - There is no tab drag or reorder (a TODO.txt idea), and no tab locking.
- **History** (`common/history.service.js`): every `loadDirectory` with a path calls `unshift` on `folderHistory`, in memory only, unbounded, with duplicates. NAVIGATE_BACK returns the entry after the *last* occurrence of the current dir, which is an odd algorithm. There is no forward navigation.
- **Copy/Move target suggestions**: see §3, Copy.
- **Persistence**: `configService.saveconfig` sends `saveconfig` and the server writes `S:temp/<username>.json` (`S:lib/socket/cmd/saveconfig.js`).
  - Stored: `{activePanelIndex, tabs, folderLatestAdded, favs, colorname}`. Tabs are serialised wholesale, including the `fileList` of search tabs **[inferred]**.
  - Triggered by SAVE_CONFIG (Ctrl+Shift+S) and by fav/unfav. There is **no auto-save on exit**.
  - On start, the saved tabs are restored and each panel loads its active tab's path. Without a saved config, panel 0 opens `startingPoints[last]` and panel 1 opens `startingPoints[0]`.
  - Sample file: `S:temp/root.json`.

---

## 6. File operations (server) and queue

**Queue** (`C:action/actionqueue.service.js`, client-side) **[read]**:
- Queues are auto-created; only queue 0 is used.
- `addActions` gives the whole batch one `jobId`.
- Actions run **strictly one at a time**. `REFRESH_PANEL` is handled on the client: it reloads the panel unless it is a search tab.
- Each executor emits `<action lowercase>` and waits for `<action><id>`.
- On success the reply's events go onto the bus, unless the action is `bulk`, then the next action runs.
- On error the action gets status ERROR and the **queue stops** (status ERROR). The footer button turns red. "Restart Queue" resumes the remaining NEW actions.
- Statuses: NEW, PENDING, PROCESSING, SUCCESS, ERROR, plus WARNING and ABORT, which are never used. There is **no cancel/abort and no byte-level progress**.
- Progress = finished / total actions of the latest job. The footer shows the text, a `<progress>` bar and a spinner or tasks icon that opens the Job Queue.
- BULK_LOWER_LIMIT = 30: above that, per-item UI events are suppressed and only the final refresh runs.

**Operations** (`S:lib/socket/cmd/*`, `S:lib/fileutil.js`):
- **copy**:
  - `stat(source)`, then `mkdirp` the target (the target folder itself when the source is a folder, else `target.dir`).
  - Then `exec`: macOS `cp -r "src" "target.dir"`. Otherwise `xcopy "src" "target\base\" /E /C /I /H /R /Y` for folders and `xcopy "src" "target.dir" /Y` for files.
  - **Linux also takes the xcopy branch** (only `osx` is checked), fails, and falls back to `fse.copy`.
  - Existing files are **overwritten silently** (`/Y`, `cp`). There is no conflict dialog (overwrite/skip/rename) anywhere.
  - Reply events: `created` (for the opposite panel) + `unselect` (source).
- **move**: same pattern, with `mv "src" "target.dir"` / `move /Y`. Fallback `fse.move` (fs-extra 2, which does not clobber by default → error **[inferred]**). Events: created, unselect, removed.
- **remove**: `fse.remove` (recursive, permanent). Event: removed.
- **mkdir**: `fs.mkdir` (no parents). Events: created + focus.
- **rename**: `fs.rename` (same dir). Events: removed, created, focus.
- **delempty**: recursive walk from the start dir. A dir with 0 entries is removed, and then its **parent is re-walked** – with no stop at the start folder, so empty ancestors above it can be deleted too **[inferred risk]**. Dotfiles such as `.DS_Store` make a folder count as non-empty. The `loops` counter decides when to send `{end}`. Afterwards the whole cache is cleared.
- **open**: Windows `start "" /max "<file>"`, macOS `open "<file>"`, Linux `evince -f`, falling back to `kpdf` (PDF viewers only). Paths are quoted but not escaped.
- **shell** (tools): replaces `$__dirname` and `$clidir` (→ `S:cli/`, which contains `cmd.bat` = `start cmd.exe /a /k cd /d %1`), then `exec`s the commands sequentially (async.waterfall stops at the first error).
- **Symlinks**: `fs.stat` follows them. A broken link becomes an entry with an `error`. Walks and search can loop on symlink cycles **[inferred]**.
- **dir race**: `end:true` is attached to the stat callback of the *last index*, but stats finish out of order, so the client may stop listening before every entry has arrived **[inferred bug]**.

---

## 7. Config files

Loaded in `S:lib/initial/initialload.js`; each step deep-merges with `extend(true, …)`:
1. `config/shortcut/<osx|windows|linux>.json` → `shortcutsconfig`
2. `config/shortcut/<username>.json` (user override; arrays are merged **by index**)
3. `config/tool/<os>.json` → `tools`
4. `config/tool/<username>.json`
5. `temp/<username>.json` → `config`
6. `config/color/<config.colorname || 'light'>.json` → `color`
7. `availableStyles` = basenames of the files in `config/color/`
8. `startingPoints`:
   - Windows: drives via `wmic logicaldisk get caption`, plus home.
   - macOS: home, `/Users`, `/Volumes/*`.
   - Linux: `/`, `/home`, `/dev`, and every `/dev/*` entry.

`systemInfo` fields: `type, platform, arch, linux, osx, windows, smartMachine, hostname, username, homedir, tmpdir` (slashes normalised to `/`), plus the keys above.

### 7.1 Shortcuts
`{"mapping":[{"shortcut":"<keypress combo>","id":"<ACTION_ID>"}, …]}` (§2).

### 7.2 Colours
`{"name":"light","colors":{"--css-var":"value",…}}` (§8).

### 7.3 Tools
`{"replaceDefaults":bool,"tools":[{id,label,shortcut,cmd,para,fileLimit,local}]}`.
- If `replaceDefaults` is set, the file's list replaces the defaults; otherwise the client defaults from `C:config/tool.service.js` are used and the file's tools are appended.
- Placeholders:
  - `$file`: one command per selected **file**, up to `fileLimit` (default 10). With no selection, the first possible row is used.
  - `$dir`: the source panel's path.
  - `$clidir`, `$__dirname`: replaced on the server.
- `cmd + para` are concatenated. `local` is unused.
- Defaults:
  - macOS: Edit (`sublime $file`, `control 4`, limit 4), CMD Shell (`open -a Terminal $dir`, `control 0`), Reveal in Finder (`open $dir`, `control shift f`).
  - Windows: CMD Shell (`$clidir\cmd.bat $dir`, `control shift m`).
  - Linux: none.
- The shipped `config/tool/windows.json` contains machine-specific paths (Sublime and 7-Zip under `C:\local\...`). It binds `f4` Edit, `control shift z` 7z and `control alt c` CMD Shell.
- Tools appear in the footer "Tools" menu, in Go-to-anything and as global shortcuts.

### 7.4 User state
`temp/<username>.json`, see §5.

---

## 8. Colour schemes

Files: `S:config/color/light.json` (the default), `dark.json`, `blackboard.json` (its `name` field says "dark" – copy-paste bug). They are switched from the footer paint-brush menu (`C:app.controller.js#setStyle`): `GET /config/color/<name>.json`, then `setProperty` on `:root`, and `data.colorname` is stored. `body` keeps a hard-coded `class="dark"`. CSS consumers: `C:app.color.css`, `C:app.css`.

The 32 variables (identical key set in all three files and in `C:config/color/colorconfig.service.js`):
- `--primary-color`, `--primary-background-color`, `--primary-background-bit-different-color`
- `--secondary-background-color`, `--secondary-color`, `--secondary-muted-color`, `--button-secondary-background-color`
- `--header-link-color`, `--header-link-bit-different-color`, `--header-link-selected-color`, `--header-fav-star-selected-color`
- `--nav-tabs-border-color`, `--item-selected-color`, `--item-muted-color`
- `--cursor-row-background-color`, `--cursor-row-color`, `--dropdown-focussed-background-color`
- `--footer-primary-background-color`, `--footer-primary-color`, `--footer-filecount-background-color`, `--footer-filecount-color`
- `--footer-btn-secondary-background-color`, `--footer-btn-secondary-border-color`, `--footer-btn-secondary-color`
- `--tooltip-background-color`, `--tooltip-color`, `--tooltip-background-input-color`, `--tooltip-input-color`
- `--scrollbar-track-background`, `--scrollbar-thumb-background`, `--scrollbar-thumb-border-color`, `--scrollbar-thumb-active-background`

Examples:
- light: cursor `#0098db`/`#fff`, selected `#e00034`.
- dark: background `#1a1a1a`, cursor `#fff`/`#000`, selected `#ee7c08`.
- blackboard: background `#0c1021`, cursor `#758129`, selected `#E0DF85`.

The dark and blackboard files reference an undefined `var(--secondary-secondary-color)`.

---

## 9. Bugs, limitations, unfinished parts

**Unfinished / placeholders** [read]:
- Find duplicates; Drop/upload; context menu; Copy/Move/Rename "TODO Options".
- `concat.js` ("TODO noch unfertig", merging split files); `tree.js` (commented out); `disks.js` (references an undefined `action`); `rmdir.js`/`unlink.js` unused.
- No Linux shortcut file; no Linux default tools; Linux "open" only works for PDFs.
- `C:TODO.txt` lists: duplicates dialog, a tool "start menu", an options dialog, focus lost after copy, "select all should respect the filter" (already done), folder space info, a FAV maintenance dialog, per-file progress for bulk copy/move, "pseudo whitespace" rename conversions (dot/underscore/space swaps), merge/split files, tab drag & drop, FXP/archives/terminal ideas, and a full spec of the intended mouse/keyboard selection model (Ctrl+Shift+Home/End range selection etc.).

**Bugs** [read unless marked]:
- Port computed with bitwise OR.
- Date column shows atime.
- Status-bar sizes off by 1000.
- `size =+` instead of `+=` in `deepselection.service.js`, so the pre-walk size is wrong.
- Delete ignores the focused row.
- Rename needs a selection.
- Multi-rename: refresh never runs; names without a dot break; the "50" step option has value 30.
- Linux copy/move take the Windows branch.
- `dir` end-event race [inferred].
- `delempty` can climb above the start folder [inferred].
- `saveconfig` trusts a client-supplied `username` for the file path (path traversal) and the socket has no auth at all.
- Shell commands are built by string concatenation (injection risk).
- macOS `control 0` is bound twice; Windows uses `f3` for Copy and both `f8`/`f9` for Delete.
- No overwrite confirmation; no cancel of running operations.
- History grows unbounded; folder button label is empty on Unix.
- Event cache flushes at most every 16 s under continuous load.

---

## 10. Recommendations for the Tauri 2 / Angular 22 / Rust rewrite

**Keep (they define the product)**:
- Dual panel with tabs per panel, Alt+1/2 tab cycling, Tab to toggle panels.
- Source/target semantics: target = the other panel; target dropdown from favs, tabs and history.
- Per-OS shortcut JSON files plus user override, with action ids as the stable API (reuse the id list in §2).
- Go-to-anything palette (extend it to all actions, not only mapped ones).
- External tools with `$file`/`$dir` placeholders and `fileLimit`.
- Regex select/deselect, invert, Insert-toggle-and-advance.
- Space = folder size.
- Recursive "change dir" folder finder with filter.
- Find into a result tab.
- Multi-rename: pattern tokens, ranges, counter, capitalisation modes, umlaut/risky/space options, 4 regex replace rows with "only if match", macros, live preview with duplicate detection.
- Group files: all 7 mode families, ignore brackets, min group size, copy/move, source-or-target root.
- Delete empty folders.
- The four clipboard formats.
- Theme files built from CSS variables (keep the variable names for the migration) plus a live colour editor.
- Job queue with visible status, restart after error, and placeholder rows.
- Breadcrumb path, favs star, recent-folders dropdown, status bar with selected/total counts.
- Persisting tabs, active panel, favs, recents and theme.

**Modernise**:
- Implement every file operation natively in Rust (`std::fs`, `walkdir`, `trash` crate) instead of shelling out to cp/xcopy/mv.
- Add conflict handling (overwrite / skip / rename / apply to all), real byte progress, cancel/pause, a parallel or per-device queue, and Tauri events in place of socket.io (`invoke` + `emit` channels shaped like the payloads in §1.3).
- Delete to the trash by default.
- Use mtime/ctime/size/permissions and show hidden files as a toggle; add a ".." row; natural (numeric) sort; type-ahead quick search; mouse/keyboard selection as specified in `C:TODO.txt` (Shift+arrows, Ctrl+Shift+Home/End).
- Add a forward/back history stack with a limit.
- Auto-save state to the app config dir (`tauri-plugin-store`) instead of `temp/<username>.json`; per-user files are unnecessary.
- Get drives and volumes through Rust (`sysinfo`), not `wmic` or `/dev/*`; open files with `tauri-plugin-opener`; run tools through `tauri-plugin-shell` with argument arrays, not concatenated strings.
- Multi-rename: check targets against files on disk, support folders and names without an extension, implement `[D]`, add undo.
- Switch shortcut notation from the Keypress syntax to the Tauri/W3C `key`-based syntax, with a conversion table.
- Watch directories with the `notify` crate instead of the 120 s listing cache.

**Obsolete for a desktop app**: Express static hosting, `/config` HTTP exposure, the `auth` hook, the port, socket.io, `username`-keyed config, `$clidir/cmd.bat` (spawn a terminal natively), the drop-to-upload dialog (replace it with OS drag & drop in and out), and AngularJS/ag-Grid 2/Bootstrap 4 alpha/jQuery/farbtastic (Angular 22 + a virtual-scroll table + a native colour input).
