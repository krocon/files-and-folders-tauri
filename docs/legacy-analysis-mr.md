# Analyse des neueren Codes (files-and-folders-mr)

> Fachliche Grundlage für die Prompts in `prompts/`, ergänzend zu `docs/legacy-analysis.md` (AngularJS/Node, 2016).
> Erstellt im Okt. 2026 aus dem lokalen Repo `~/WebstormProjects/files-and-folders-mr` (Angular 20, NestJS, Electron;
> nur lesend, Stand Commit `7e72193`, API-Version `19.08.2025`). Englisch belassen, damit Bezeichner 1:1 zum Code
> passen. **[read]** = aus dem Code, **[inferred]** = Interpretation. Prompts verweisen als „mr §…“ auf die Abschnitte.
>
> Lizenz: Custom Source-Available License, Rechteinhaber GUI Expert GmbH (Marc). Verhalten, Layout und
> Konfigurationsformate dürfen übernommen werden; Code nur nach Marcs ausdrücklicher Freigabe.

Stack [read]: Angular 20 (`^20.2.0-rc.0`) + Angular Material (standalone components, OnPush, `@if/@for`), `@guiexpert/angular-table ^20.1.79` / `@guiexpert/table ^1.1.79`, `monaco-editor ^0.52`, `ngx-socket-io 4.9.1`. The backend is NestJS (REST under the `/api` prefix on port 3333, Socket.IO on `WS_PORT` 3334). Electron 30 is a thin shell around it.

---

## 1. Window layout (the most important part)

### 1.1 Grid
`apps/fnf/src/app/feature/main/file.component.html` + `.css` [read]

The root element is `div.fnf-main-div`, a CSS grid with `grid-template-rows: auto auto 1fr auto auto auto`, `height:100%`, `overflow:clip`. The rows, from top to bottom:

| # | class | content | split? |
|---|---|---|---|
| (abs) | `.fullscreen-toggle-div` | absolute top-right `mat-icon-button`, `fullscreen` / `fullscreen_exit`, uses `document.documentElement.requestFullscreen()` | – |
| 1 | `.header-top-div.split-div` (`fnf-header-bg/fg-color`) | **breadcrumb** left / separator / breadcrumb right | yes |
| 2 | `.header-bottom-div.split-div` | **tab panel** left / separator / right | yes |
| 3 | `.content-div.split-div` (`fnf-files-panel fnf-table-background`) | **file table** left / separator (`title="Double-click for 50% / 50%"`) / right | yes |
| 4 | `.footer-top-div.split-div` (`fnf-footer-bg/fg-color`) | **summary label** left / separator / right | yes |
| 5 | `.footer-center-div` | **shell panel** (only when `shellVisible`). It gets the path of the active panel. | no |
| 6 | `.footer-bottom-div` | **button panel**, which gets `buttonEnableStatesArr[activePanelIndex]` | no |

Every `.split-div` is a grid with `grid-template-columns: calc(var(--split-panel-left-width)) var(--split-panel-separator-width) 1fr`. The defaults on `.fnf-main-div` are `--split-panel-left-width: calc(50vW - 4px)`, `--split-panel-right-width: calc(50vW - 4px)`, `--split-panel-separator-width: 8px`, `--split-panel-bg-dragging-color: rgba(0,247,255,.3)`. Each split row has its own `.panel-separator` with `cursor: col-resize`, and the dragging colour on hover [read].

Every left/right cell has `(click)="setActivePanel(i)"` and toggles `fnf-active-panel` or `fnf-inactive-panel`. Clicking anywhere in a column (breadcrumb, tabs, table or summary) activates that panel [read].

### 1.2 Splitter
`service/splitpane/split-pane-mouse.service.ts`, `window-resize.service.ts` [read]

- On `mousedown` on any separator, `mousemove` on `document` sets `--split-panel-left-width = clientX-4 px` and `--split-panel-right-width = (w-clientX-4) px` on the **main div**. All five split rows therefore move together. While dragging, the row gets the class `.resizing`, which sets `user-select:none` and colours all separators. The handler runs outside NgZone.
- `dblclick` on a separator sets both widths to `'50vW - 4px'`. This value has no `calc()`. It works inside `grid-template-columns: calc(var(..))`, but `max-width: var(--split-panel-left-width)` on `.panel-left` becomes invalid [inferred, minor bug].
- `window.resize` is debounced by 250 ms. It updates `--viewport-width` and, if the window becomes narrower than the left panel, resets the left panel to `50%`.
- The splitter position is **not persisted** [read: no storage call].

### 1.3 Breadcrumb (row 1)
`header/breadcrumb/*` [read]

- Normal tab: shows `/` followed by one clickable `div` per path segment (`{{base}}/`), with an underline on hover. The row is `flex; justify-content:flex-end`, so with long paths the segments are aligned to the right. Next comes the **fav toggle** (`app-fav-toggle`, a bookmark SVG: filled with a check mark when the path is a favourite, outline otherwise; a click calls `FavDataService.toggleFav(path)`), then a filler `div.w-100`.
- Find tab: shows `Search: "<pattern>"`, with a tooltip containing the `findData` JSON. A double click reopens the Find dialog with the previous `FindDialogData` and `newtab:false`.
- Clicking a segment emits `pathClicked`, which triggers `appService.onChangeDir(item.dir, panelIndex)`.

### 1.4 Tab panel (row 2)
`header/tabpanel/*` [read]

The row is a flex container with `padding 4px 10px 0`. From left to right:
1. **Favs-and-latest menu** (`fnf-fav-menu`): a `mat-button` with the `expand_more` icon. The left panel button has `fnfAutofocus`. The menu contains, in order: `root` (only when a dockerRoot is set) · `Volumes:` (from the socket event `volumes`, hidden when a docker root is set; macOS lists `/Volumes/*`) · `Drives:` (Windows drives via `wmic logicaldisk get caption`) · divider · `Favs:` (star icon) · divider · `Latest:` (schedule icon, max 10). Duplicates are removed: favs exclude drives, latest excludes drives and favs. The actions `SELECT_LEFT_PANEL` / `SELECT_RIGHT_PANEL` activate the panel **and open this menu**.
2. **`mat-tab-group`**: animations are disabled and pagination is enabled. `max-width: calc(100% - 260px)`, or `- 400px` when the filter is active. Each tab label (`app-tab`) shows `shortenString(lastSegment)`. A find tab (`path` starts with `tabfind`) shows a `search` icon with a tooltip `Search <pattern>`. The tab is tracked by `tab.path`. A ResizeObserver keeps the active tab visible.
   - **Right click / long press (500 ms) on the label**: tab context menu with Reload · Close this tab (disabled if it is the only tab) · Move tab to right/left panel · Clone this tab for right/left panel · Move this tab to the left · Move this tab to the right.
   - A **long press** opens a second hidden menu, the **history menu**: `tab.history` entries (arrow_forward icon), click = cd. Note: both menus are wired to long press. The context menu is opened by `contextmenu`, the history menu by `onLongPress` [read].
   - **Shift+click** on a tab removes it. **Double click** triggers `RELOAD_DIR_0/1`.
3. `+` / `−` buttons (`add_circle_outline`, `remove_circle_outline`) with tooltips from `'ADD_NEW_TAB' | fnfShortcut`. Add clones the current tab and selects it. Remove deletes the current tab if there is more than one.
4. A right-aligned `filter-div` (`row-reverse`) containing: the hidden-files toggle (`visibility` / `visibility_off`), the filter toggle (`filter_alt` / `filter_alt_off`), and a filter `input` (visible only when `filterActive`, autofocus, double click clears it, every keyup triggers `dataChanged`).

Active/inactive styling (`tabpanel.component.global.css`) [read]: the tab indicator is hidden and tabs are 42 px high with 8 px padding. The selected tab gets a border on three sides (`--fnf-header-border-color`) and a background `--fnf-header-selected-tab-bg-color`. In the **active panel** the selected tab uses `--fnf-activepanel-header-selected-tab-bg/fg-color` and the borders use `--fnf-activepanel-header-border-color` (= the primary colour in light). Small header buttons get the activepanel header background in the inactive panel and vice versa.

### 1.5 File table (row 3)
See section 3.

### 1.6 Summary label (row 4)
`footer/summarylabel/*` + `service/grid-selection-count.service.ts` [read]

Format: `<selSize> / <allSize>  in <selFiles> / <files> Files, <selDirs> / <dirs> Folders`. In the active panel the "selected" numbers get the class `fnf-active-fg-color`. The size tooltips show the exact number of bytes. `..` rows are excluded. Sizes use `formatFileSize` (`<1024 → "N bytes"`, otherwise B/KB/MB… with 2 decimals; `0 → "0.00 B"`).

### 1.7 Shell panel (row 5)
`footer/shellpanel/*` [read]

A `mat-form-field` (outline) with prefix `{{path}}>`, a red `!` on error and an input with the placeholder "Enter shell command". Autocomplete is debounced by 500 ms and comes from the history plus `GET /api/shell-autocomplete`. Enter posts `POST /api/shell [{path, cmd, para:''}]`. On success the command is added to the history (`shell-history`, max 20) and stdout opens in a **bottom sheet** with a read-only Monaco editor (`vs-dark`, language `shell`). On error the message is shown inline as a suffix and as a tooltip. Focus in/out sets `shellInputHasFocus`, which disables global key handling. Visibility is toggled with `TOGGLE_SHELL` (`shift+f11`) and persisted in localStorage `shellVisible` (default false). A TODO for up/down history and Esc is still open.

### 1.8 Button panel (row 6)
`footer/buttonpanel/*` [read]

The bar is a wrapping flex row (gap 10) of `mat-stroked-button`s, from left to right:
1. **Function buttons**: `currentButtons`, chosen from the button config by pressed modifier. Each button shows a `<fnf-shortcut>` badge (floated left) followed by the short label (the label with `...` removed). It is disabled when `!buttonEnableStates[id]` (disabled opacity .3). The tooltip lists all shortcuts.
2. **`Actions ▲`**: a `mat-menu` containing a 4-column grid (`350px 350px 330px 380px`). Every entry shows its label and a right-floated shortcut badge.
3. **`Tasks`** with a busy-bee status icon. The tooltip shows `finished / total`. A click opens the task list as a bottom sheet (`panelClass fnf-top-sheet`).
4. **Palette icon**: theme menu. Custom themes first, a divider, then the defaults, each labelled `L&F <name>`.
5. **Keyboard icon**: `OPEN_SHORTCUT_DLG`.
6. **Bug icon**: `PRINT_DEBUG`, which writes to the console.
7. A hidden `<a id="open-call-action">` that opens the Call Action dialog.

There are no separate "Sel" or "Tools" footer menus. Tools appear at the bottom of column 4 of the Actions menu [read].

**Modifier switching** (`updateButtonList`, on `window:keydown` and `keyup`) [read]: `metaKey → buttons.cmd`, otherwise `altKey → buttons.alt`, otherwise `shiftKey → buttons.shift`, otherwise `buttons.default`. **Ctrl has no button set**, even though `metaKeys.ctrl` is tracked [read].
The badge comes from `getSimplestShortcutsByAction(id, metaKeys)`. It goes through the shortcuts of the action, strips the modifier words that are currently held, and returns the first result that is a single token. Example: with Shift held, the Rename button shows `F6` (from `shift+f6`).

**Default button config** `apps/fnf-api/src/assets/button/defaults/data.json` [read]:
```json
{"default":["OPEN_EDIT_DLG","OPEN_COPY_DLG","OPEN_MOVE_DLG","OPEN_MKDIR_DLG","OPEN_DELETE_DLG"],
 "shift":["OPEN_CREATE_FILE_DLG","OPEN_COPY_DLG","OPEN_RENAME_DLG","OPEN_MKDIR_DLG","OPEN_DELETE_DLG"],
 "cmd":["OPEN_VIEW_DLG","OPEN_COPY_DLG","OPEN_MULTIRENAME_DLG","OPEN_MKDIR_DLG","OPEN_DELETE_DLG"],
 "alt":["OPEN_VIEW_DLG","OPEN_COPY_DLG","OPEN_MULTIRENAME_DLG","OPEN_MKDIR_DLG","OPEN_DELETE_DLG"]}
```
The labels are Edit, Copy, Move, MkDir, Delete. With Shift: Create File, Copy, Rename, MkDir, Delete. With Cmd/Alt: View, Copy, Multi Rename, MkDir, Delete.

**Actions menu content** (`buttonpanel.component.ts`) [read]:
- **menuItems0**: OPEN_GOTO_ANYTHING_DLG, –, RELOAD_DIR, OPEN_CHDIR_DLG, TOGGLE_FILTER, TOGGLE_HIDDEN_FILES, TOGGLE_SHELL, –, COPY_2_CLIPBOARD_NAMES, COPY_2_CLIPBOARD_FULLNAMES, COPY_2_CLIPBOARD_NAMES_AS_JSON, COPY_2_CLIPBOARD_FULLNAMES_AS_JSON
- **menuItems1**: OPEN_FIND_DLG, –, ENHANCE_SELECTION, REDUCE_SELECTION, TOGGLE_SELECTION, SELECT_ALL, DESELECT_ALL, –, NAVIGATE_LEVEL_DOWN, NAVIGATE_BACK, –, SELECT_LEFT_PANEL, SELECT_RIGHT_PANEL, TOGGLE_PANEL, –, ADD_NEW_TAB, REMOVE_TAB
- **menuItems2**: OPEN_COPY_DLG, OPEN_MOVE_DLG, OPEN_DELETE_DLG, OPEN_MKDIR_DLG, OPEN_RENAME_DLG, OPEN_ATTRIBUTE_DLG, OPEN_UNPACK_DLG, OPEN_PACK_DLG, OPEN_DOWNLOAD_DLG, –, OPEN_MULTIRENAME_DLG, OPEN_MULTIMKDIR_DLG, OPEN_GROUPFILES_DLG, OPEN_DELETE_EMPTY_FOLDERS_DLG
- **menuItems3**: OPEN_SETUP_DLG, OPEN_THEMES_DLG, OPEN_THEME_CONFIG_DLG, OPEN_BUTTON_CONFIG_DLG, OPEN_FILETYPE_CONFIG_DLG, OPEN_TOOL_CONFIG_DLG, OPEN_PROMPT_CONFIG_DLG, OPEN_SHELL_DLG, OPEN_ABOUT_DLG, –, then the **tools** from the tool config (label plus shortcut badge).

**Shortcut badge** (`shortcut/shortcut.component.*`) [read]: renders each token as `<b class="fnf-shortcut">`, character by character. A `+` is drawn as a light separator at 50 % opacity. The colours come from `--fnf-footer-shortcut-bg/fg-color` (#444/#eee in light). Tokens are produced by `getShortcutAsLabelTokens`, which maps `ctrl→^`, `shift→⇧`, `cmd→⌘`, `plus/add→+`, `minus/subtract→-`, `multiply→*`. **`alt` stays as the literal text "alt"** (there is no ⌥) [read].

### 1.9 Other UI observations
- `ngDoCheck` writes a debug counter into `document.title` on every change-detection cycle [read, bug].
- Routes [read] (`app.routes.ts`): `/files` (main), `/about`, `/shell` (server shell), `/setup`, `/themes`, `**`→files. About, Setup and Server Shell are full-page routes, not dialogs. The theme editor opens in `window.open('/themes')` at 1200×1000.

---

## 2. Actions and shortcuts

**Action ids** (`domain/action/fnf-action.enum.ts`) [read]. Pseudo actions: `DUMMY_ACTION, DO_NOTHING, PRINT_DEBUG, '-'`. Real actions:
OPEN_CALL_ACTION_DLG, ADD_NEW_TAB, ARROW_DOWN, ARROW_UP, COPY_2_CLIPBOARD_FULLNAMES, COPY_2_CLIPBOARD_FULLNAMES_AS_JSON, COPY_2_CLIPBOARD_NAMES, COPY_2_CLIPBOARD_NAMES_AS_JSON, DESELECT, DESELECT_ALL, END_PRESSED, ENHANCE_SELECTION, ENTER_PRESSED, HOME_PRESSED, NAVIGATE_BACK, NAVIGATE_FORWARD, NAVIGATE_LEVEL_DOWN, NEXT_TAB, OPEN_ABOUT_DLG, OPEN_ATTRIBUTE_DLG, OPEN_CHDIR_DLG, OPEN_COLORCONFIG_DLG, OPEN_COPY_DLG, OPEN_DELETE_DLG, OPEN_DELETE_EMPTY_FOLDERS_DLG, OPEN_DESELECT_DLG, OPEN_EDIT_DLG, OPEN_FIND_DLG, OPEN_FIND_DUBLICATES_DLG, OPEN_GOTO_ANYTHING_DLG, OPEN_GROUPFILES_DLG, OPEN_JOB_QUEUE_DLG, OPEN_MKDIR_DLG, OPEN_MOVE_DLG, OPEN_MULTIMKDIR_DLG, OPEN_MULTIRENAME_DLG, OPEN_RENAME_DLG, OPEN_SELECT_DLG, OPEN_SETUP_DLG, OPEN_THEMES_DLG, OPEN_BUTTON_CONFIG_DLG, OPEN_FILETYPE_CONFIG_DLG, OPEN_TOOL_CONFIG_DLG, OPEN_PROMPT_CONFIG_DLG, OPEN_THEME_CONFIG_DLG, OPEN_SHELL_DLG, OPEN_SHORTCUT_DLG, OPEN_UNPACK_DLG, OPEN_PACK_DLG, OPEN_DOWNLOAD_DLG, OPEN_VIEW_DLG, OPEN_CREATE_FILE_DLG, OPEN_TASK_DLG, OPEN_MENU, PAGEDOWN_PRESSED, PAGEUP_PRESSED, PRINT_DEBUG, REDUCE_SELECTION, RELOAD_DIR, RELOAD_DIR_0, RELOAD_DIR_1, REMOVE_TAB, SAVE_CONFIG, SELECT_ALL, SELECT_LEFT_PANEL, SELECT_RIGHT_PANEL, SPACE_PRESSED, SHIFT_SPACE_PRESSED, TOGGLE_FILTER, TOGGLE_HIDDEN_FILES, TOGGLE_PANEL, TOGGLE_SELECTION, TOGGLE_SELECTION_CURRENT_ROW, TOGGLE_SHELL. The `CHANGE_LAF_<NAME>` ids are handled dynamically in the button panel. Tool ids (`CMD_*`) come from the tool config.

**Dead ids** (only present in the enum, the labels or the shortcut JSON; nothing handles them) [read via grep]: `OPEN_FIND_DUBLICATES_DLG`, `OPEN_SELECT_DLG`, `OPEN_DESELECT_DLG`, `SAVE_CONFIG`, `OPEN_COLORCONFIG_DLG`, `OPEN_JOB_QUEUE_DLG`, `DESELECT`, plus `EDIT_FILE` in the shortcut JSON. **Find duplicates is not implemented.**

**Labels** (`fnf-action-labels.ts`) [read], selection: Copy, Move, MkDir, Create File, Delete, Edit, View, Left Panel, Right Panel, Toggle Panels, Add Tab, Remove Tab, Toggle Tabs (NEXT_TAB), Toggle Filter Input, Toggle Hidden Files, Toggle Shell, Menu, Taskmanager..., Setup..., Fancy Theme Editor..., Theme/Button/File Type/Tool/Prompt Configuration..., About..., Server Shell..., Go to anything..., Group Files..., Change Dir..., Find Dublicates..., Multi Rename..., Multi MkDir..., Rename..., Clean Folders..., Find..., Reload..., File Attributes..., Enhance Selection..., Shortcuts..., Download..., Unpack..., Pack..., Reload Left/Right, Select All, Deselect All, Enhance/Reduce Selection, Toggle Selection, Parent Dir (NAVIGATE_LEVEL_DOWN!), History Back, Forward, Execute File (ENTER), Jump to begin/end/top/bottom, Change Focus. Short label = label with `...` removed.

**Default shortcuts** `apps/fnf-api/src/assets/shortcut/defaults/{osx,windows,linux}.json` [read]. `windows.json` and `linux.json` are **identical**. `osx.json` differs only as follows: it has `ctrl+k f6 → OPEN_TASK_DLG` and `ctrl+k ctrl+m → OPEN_MENU` (chords) plus `ctrl+m → DUMMY_ACTION`, where Windows/Linux use `ctrl+f11 → OPEN_TASK_DLG`, `ctrl+f12 → OPEN_MENU` and `cmd+ctrl+enter → DUMMY_ACTION`. The table below is compacted, grouped by action:

```
f10 CALL_ACTION | f3 VIEW | f4 EDIT | shift+f4 CREATE_FILE | f5 COPY | f6 MOVE | shift+f6 RENAME
cmd+f6, ctrl+f6, ctrl+alt+m MULTIRENAME | shift+f7, ctrl+alt+n MKDIR (no plain f7!) | f8, ctrl+delete DELETE
space SPACE_PRESSED | shift+space SHIFT_SPACE_PRESSED | ctrl+shift+space TOGGLE_SELECTION_CURRENT_ROW
cmd+left HOME | cmd+right END | cmd+up PAGEUP | cmd+down PAGEDOWN | up ARROW_UP | down ARROW_DOWN | enter ENTER
ctrl+cmd+g / cmd+ctrl+g GOTO_ANYTHING | ctrl+cmd+c COPY | ctrl+cmd+m MOVE | ctrl+alt+d, ctrl+alt+9 CHDIR
ctrl+alt+shift+d DELETE_EMPTY_FOLDERS | cmd+alt+left SELECT_LEFT_PANEL | cmd+alt+right SELECT_RIGHT_PANEL
tab TOGGLE_PANEL | shift+tab NEXT_TAB | cmd+alt+w REMOVE_TAB | cmd+alt+t ADD_NEW_TAB | ctrl+cmd+s SAVE_CONFIG
ctrl+alt+g GROUPFILES | ctrl+alt+shift+f FIND_DUBLICATES | cmd+alt+r RENAME | ctrl+f FIND | ctrl+cmd+r RELOAD_DIR
ctrl+alt+a SELECT_DLG | ctrl+cmd+a SELECT_ALL | ctrl+cmd+d DESELECT_ALL | cmd+alt+d DESELECT_DLG
ctrl+alt+plus ENHANCE_SELECTION | ctrl+alt+minus REDUCE_SELECTION | ctrl+space TOGGLE_SELECTION
cmd+alt+down NAVIGATE_LEVEL_DOWN | cmd+alt+up NAVIGATE_BACK | cmd+alt+shift+up NAVIGATE_FORWARD
cmd+alt+f TOGGLE_FILTER | cmd+alt+shift+h TOGGLE_HIDDEN_FILES | shift+f11 TOGGLE_SHELL
cmd+e EDIT_FILE | cmd+shift+c CMD_SHELL | ctrl+cmd+shift+r CMD_REVEAL_IN_FINDER
cmd+ctrl+f1 RELOAD_DIR_0 | f2 RELOAD_DIR_1 | f3 COLORCONFIG | f4 JOB_QUEUE | f5 MULTIMKDIR | f6 SETUP | f7 SHELL_DLG
  | f8 SHORTCUT_DLG | f9 UNPACK | f10 PACK | f11 DOWNLOAD
cmd+ctrl+shift+f1 ABOUT | f2 ATTRIBUTE | f3 THEMES | f4 BUTTON_CONFIG | f5 FILETYPE_CONFIG | f6 TOOL_CONFIG
  | f7 THEME_CONFIG | f8 PROMPT_CONFIG
cmd+ctrl+alt+f1..f8 CHANGE_LAF_ BITBUCKET, BLACKBOARD, COFFEE, COMBAT, CYPRESS, LIGHT, NORTON, PAPER
```
There is also an existing user custom file `shortcut/custom/osx.json` [seen, not read in detail].

**Matching** [read] (`utils/shortcut-util.ts`, `service/config/shortcut.service.ts`, `file.component.ts`):
- The key event becomes `[ctrl][alt][shift][cmd] key`, joined with `+`. Key name mapping: `' '→space`, `arrowup→up`, `escape→esc`, `delete→del`, and so on. `cmd` = `metaKey` on **all** OSes, which is the Windows key on Windows [inferred].
- Lookup is a direct `activeShortcuts[eventString]` against the **raw JSON keys**. As a result [inferred bugs]:
  - Keys whose modifier order is not ctrl, alt, shift, cmd never match. `cmd+alt+left` would be generated as `alt+cmd+left`, so SELECT_LEFT_PANEL, REMOVE_TAB, ADD_NEW_TAB, NAVIGATE_* and others do not fire from the keyboard. This is probably why duplicates such as `ctrl+cmd+g` and `cmd+ctrl+g` exist.
  - `ctrl+delete` never matches because the event produces `del`. `ctrl+alt+plus` never matches because the event produces `+`.
  - Tool shortcuts (`"ctrl shift 4"`) are stored through `harmonizeShortcut`, which joins with **spaces**, so they never match `+`-joined event strings.
  - On Windows the tool shortcut `f4` overwrites `OPEN_EDIT_DLG`.
- Global actions are dispatched on **keyup**, in `FileComponent.onKeyUp`. This is done because some browsers swallow F-key keydown. Single printable keys without ctrl/meta/alt build a **quick-search** prefix instead (section 3). Arrows and Space are also routed via keyup actions, while the selection manager handles keydown Space. The result is no key repeat for arrow navigation [inferred].
- Chords are handled by `KeyListenerService` with a 2 s timeout [read].
- Shortcut editor: `feature/shortcut/shortcut-dialog.component` (OS selector, table of action, label, shortcut) and `edit/edit-shortcut-dialog` (captures key presses including chord sequences). It saves with `PUT /api/shortcuts/:os` and resets with `POST /api/shortcuts/:os/reset`. The server returns the **custom file instead of** the defaults, with no merge [read].

---

## 3. File table (@guiexpert/table)
`feature/main/filetable/*` [read]

**Template**: `<guiexpert-table (mouseClicked) (tableReady) [debounceMouseClickDelay]="150" [tableModel] [tableOptions] class="ge-table file-table">`.

**How it is built** (this matters for reuse):
```ts
rowHeight = 34;
tableOptions: TableOptionsIf = { ...new TableOptions(),
  hoverColumnVisible:false,
  defaultRowHeights:{header:34, body:34, footer:0},
  horizontalBorderVisible:false, verticalBorderVisible:false,
  externalFilterFunction: this.filterFn.bind(this),
  getSelectionModel: () => undefined,   // GE selection disabled; own selection manager
  getFocusModel: () => undefined,       // GE focus disabled; focus index lives in the body model
  shortcutActionsDisabled: true,        // GE key bindings off
  columnsDraggable:false };
columnDefs = [
  ColumnDef.create({property:"base", headerLabel:"Name", width:new Size(100,'weight'), minWidth:new Size(200,'px'),
     bodyRenderer: rwf.create(NameCellRendererComponent, cdr), header/bodyClasses:["ge-table-text-align-left"],
     sortable:()=>true, sortComparator:fileNameComparator}),
  ColumnDef.create({property:"ext",  headerLabel:"Ext",  width:new Size(60,'px'),  bodyRenderer: ExtensionCellRenderer, left, extComparator}),
  ColumnDef.create({property:"size", headerLabel:"Size", width:new Size(100,'px'), bodyRenderer: SizeCellRenderer, right, sizeComparator}),
  ColumnDef.create({property:"date", headerLabel:"Date", width:new Size(160,'px'), bodyRenderer: DateCellRenderer, left, dateComparator}) ];
columnDefs.forEach(d => { d.sortable=()=>true; d.sortIconVisible=()=>true; });
bodyAreaModel = new FileTableBodyModel(columnDefs, 34, onFocusChanged);  // extends AreaModelObjectArrayWithColumndefs<FileItemIf>("body", [], defs, 34)
tableModel = TableFactory.createTableModel({columnDefs, tableOptions, bodyAreaModel});
```
`RenderWrapperFactory` (from `@guiexpert/angular-table`) wraps Angular components that implement `ComponentRendererIf.setData(rowIndex, colIndex, areaIdent, areaModel, cellValue)`.

`FileTableBodyModel.getCustomClassesAt(row)` returns `fnf-selected-row` when `row.meta.selected` is set, and `fnf-focused-row` when the row is the focused index. `setFocusedRowIndex` calls `tableApi.ensureRowIsVisible`. The model also provides `getCriteriaFromFocussedRow()` → `{base, dir}` and `setFocusByCriteria`.

**TableApi calls used**: `setRows`, `addRows`, `removeRows(items, equalFileItem)`, `updateRows`, `findRows`, `externalFilterChanged`, `reSort`, `repaint`, `repaintHard`, `ensureRowIsVisible`, `getDisplayedRowCount`.

**Renderers**:
- **Name**: a 24 px inline Material Symbols SVG plus a label with ellipsis. The tooltip is the full path. Folders are shown as `[name]`, files without their extension, the parent entry as `..`. Find results (`abs=true`) show the full path with `direction:rtl`, so long paths are cut at the start. The **icon is chosen by a hard-coded mapping in the renderer** (`getIconType`), not by the filetype config. Selected rows get the `selectedfile` / `selectedfolder` icons (with a check mark). The mapping: `.DS_Store→ios`, `.zshrc→terminal`, dotfiles→`hidden`, `package*.json→build`, no extension→`question`, video, audio, avc, hevc, csv/tsv, txt, odt, xls(x)→table, epub/rtf→book, cbr/cbz/cb7→comic, bmp/jpg/ico/jpeg→image, svg, gif, png, signature, doc(x)→document, pdf, ppt(x)→presentation, log, php, js/ts→js, html, css/less/sass/scss, json, java/k→code, zip, rarp(!)/7z→packed, xml, md/yaml→markdown, bak, app/exe/bat/cmd/sh/msi→executable, fonts, otherwise `other`. An EPERM error shows the `hidden` icon.
- **Ext**: the extension without the dot. Empty for directories and for `..`.
- **Size**: `formatFileSize` (2 decimals). The tooltip shows `1,234 bytes (1.21 KB)`. Directories with an unknown size show ` DIR`. Files with `meta.status==='temp'` show nothing and get a "temporary file" tooltip.
- **Date**: a grid `9.5ch 1fr` with `yyyy-mm-dd` plus a small `HH:MM`. The tooltip shows the full timestamp.

**Sorting**: `fileItemSorter` always puts `..` first and directories before files, then sorts case-insensitively with `localeCompare`. The name comparator ignores the direction factor. The size, ext and date comparators keep directories on top regardless of direction. On every start `app.component.ts` overwrites `localStorage fnf-file-table-{0,1}-sortingState` with name ascending, so the sort order is not really persisted [read].

**Filter** (`filterFn`): `..` always passes. A row passes when (`!filterActive` or the name contains the filter text, case-insensitive) and (`hiddenFilesVisible` or the name does not start with `.`). Both settings are per tab.

**Selection model** (`selection-manager.ts`, a custom `SelectionManagerForObjectModels`) [read]:
- Selection is stored on the row (`row.meta.selected`). `..` is not selectable. The row key is `dir/base`.
- Mouse: a plain click deselects everything and selects the clicked row, and also sets focus. Shift+click selects the range from the previous click. Ctrl/Cmd+click toggles a row. Ctrl/Cmd+Alt+click deselects a row. A double click opens: directory or zip → cd, file → `open` (OS default app via the queue).
- Keyboard: Space (keydown) toggles the focused row and moves focus down; Shift+Space moves up. The Space keyup action (`SPACE_PRESSED`) also starts a recursive **folder-size walk** for a focused directory (`walkdir` socket, `DirWalker` updates the size cell). Shift+Up/Down extends the selection range; Ctrl/Cmd+Up/Down toggles the row.
- Selection and focus are **persisted per panel and per directory** in localStorage: `selection0/1` (`{[path]: keys[]}`) and `focus0/1` (`{[path]: {dir,base,ext?}}`). Both are re-applied after every listing.
- Selection dialog (ENHANCE/REDUCE): the input is a space-separated list of terms. `-term` excludes, `a|b` means OR. Terms match as substrings of the name. The default is the extension of the focused file.

**Quick search**: alphanumeric keys build a prefix that resets after 2 s (or on Esc). The first row whose name starts with the prefix gets focus [read].

**Button enable states** (`libs/fnf-data/src/models/cmd/get-button-enable-states.fn.ts`) [read]. These are computed from the selected rows, or from the focused row when nothing is selected (never `..`):
- COPY, MOVE, DELETE, PACK, DOWNLOAD: at least one item, not inside a zip
- EDIT, VIEW: exactly one file, not inside a zip
- RENAME: exactly one item
- UNPACK: exactly one item with an extension in `zip|rar|7z|tar|gz|bz2|xz`
- MULTIRENAME: more than one item
- MKDIR: not a find tab
- CREATE_FILE: always

**Directory loading**: `POST /api/readdir` (DirPara `{path, componentId:'file-panel-N', nocache, rid}`) → `DirEvent[]`, followed by a socket `watch`. Dir events can be `list`, `listpreview`, `add`, `addDir`, `unlink`, `unlinkDir`, `change`, `checkOrAddDir`, `checkOrAddFile`, `focus`, `select`, `unselect`, `unselectall`, `reload`, and they are applied incrementally to the table. A `..` row (`FileItem(getParent(path), '..', ..., isDir)`) is prepended unless the path is a root or a find tab. **Zip browsing**: the path `file.zip:` (regex `EXP_ZIP_FILE_URL = /([^:]+.\w{3}):(.*)/`) is listed with `node-stream-zip`.

**Mkdir suggestion**: if at least 2 sibling folders match `^[A-Za-z]{1,10}\d{2,}$` (for example S01, S02), the next name in the sequence is suggested.

---

## 4. Tabs, panels, state and persistence

Everything is stored in **browser localStorage** through `common/typed-data.service.ts`. Nothing is stored on the server except config files [read].

| key | content |
|---|---|
| `tabs0`, `tabs1` | `TabsPanelData {panelIndex, tabs: TabData[], selectedTabIndex}`. Default `[TabData('/')]`. |
| `TabData` | `{path, history: string[] (max 15, newest first, unique), historyIndex, findData?, filterActive, hiddenFilesVisible(false), filterText, id}` |
| `activePanelIndex` | 0 or 1 |
| `fav` | string[] (toggled from the breadcrumb) |
| `latest` | string[] (max 10, added on every cd that is not a history navigation) |
| `selection0/1`, `focus0/1` | see section 3 |
| `shellVisible`, `shell-history`, `servershell-history` | shell state |
| `theme` | theme name (default `light`) |
| `find-dlg-pattern`, `clean-dlg-pattern`, `group-files-dlg-pattern`, `groupFilesData`, `multiRenameData`, `multiMkdirData` | last dialog inputs |
| `edit-selected-data`, `edit-readonly`, `monaco-editor-user-options` | handover to the viewer/editor window |

History: NAVIGATE_BACK increments `historyIndex` (history is newest first), NAVIGATE_FORWARD decrements it and wraps around. Both set `ChangeDirEventService.skipNextHistoryChange`. Find tabs use the pseudo path `tabfind…`, with `findData` holding the socket keys. `checkPath` (POST `/api/checkpath`) validates or normalises paths. Goto-anything uses `filterexists` to drop history entries that no longer exist. Drives: `GET /api/drives` (Windows). Volumes: socket `getvolumes` → `volumes` (macOS `/Volumes`). Docker: `GET /api/config` → `{incompatiblePaths, containerPaths, startPath, dockerRoot}`.

---

## 5. Dialogs (Material dialogs unless noted)
Templates are in `feature/cmd/*` [read via grep of labels and controls].

- **Copy / Move / Delete** (one component `copyormoveordelete`): title, source list, `fnf-walk-data` (live file count and size of the sources via walkdir), arrow, **Target** input with a suggestions menu (directories of all tabs). Delete has no target. The default target is the path of the other panel. Every selected item becomes its own queue job.
- **Mkdir** "Create Folder": target (with sequence suggestion). **Create File**: target. Both go into a quick queue and set focus to the new item.
- **Rename**: source (read-only) and the new name.
- **Multi Rename**: preview table (GE table) plus a form. Fields: `renameTemplate` "New name" (macros `[N]` name, `[E]` ext, `[C]` counter, `[P]` parent, `[Q]` grandparent, `[R]` great-grandparent), counter start/step/digits (options 1..10 digits; start 0/1/10/…; step 1/5/10/20/**30 labelled "50"**/100/1000), capitalize (none/upper/lower/first letter/words), checkboxes for Ignore Extension, Fix german umlauts, Remove parent dir, Replace risky chars, Space to underscore, a "Search and replace" list (textFrom/textTo, `regExpr` "Use RegExp", `ifFlag` "only if match", `ifMatch`), `strategy`. **AI mode**: a button posts `POST /api/ai/convertnames {files}` → `{url: newBase}`. It needs `FNF_OPENAI_API_KEY` (or llama). `hasopenaiapikey` decides whether the button is available.
- **Multi MkDir**: folder name template, counter start/end/step/digits, letter case.
- **Group Files**: mode (`runnig_number`, `ebook_mode`, `new_folder`, `minus_separator`, `first_word`, `first_letter[_lower|_upper]`, `two_letters[_lower|_upper]`), min size (none/2/3/4/5/10), Ignore Brackets, Use Source Directory, `strategy` (including `AI` → `POST /api/ai/groupfiles`), preview table.
- **Find**: "Search for" (glob pattern, default `**/*.*`, templates dropdown from the search config), "Search in" (comma-separated folders), Directories only, New tab. Results stream into a tab (socket `find`).
- **Find duplicates**: **not implemented** (shortcut only).
- **Clean Folders** (`OPEN_DELETE_EMPTY_FOLDERS_DLG`): "Clean in", "Delete Files" pattern (default `**/*.bak`), Delete empty folders checkbox → `POST /api/clean`.
- **Change Attributes**: Archive, Hidden, Read only, System, "Change date/time" with date and time fields → `POST /api/getfileattributes` / `setfileattributes`.
- **Pack**: target filename, target directory, password (optional), format (default 7z), compression level (default 5). Uses node-7z with 7zip-bin. **Unpack**: target folder name and password. **Download** (browser only): same fields as Pack, produces a blob download.
- **View/Edit (F3/F4)**: `window.open('/edit.html')` (800×600), a standalone page (`apps/fnf/src/edit.html`) with Monaco from `assets/monaco`. It offers a theme select, toggles for line numbers, minimap and word wrap, search/replace, and Save (`POST /api/file?name=`), and loads with `GET /api/file?name=`. In read-only mode the Save button is hidden. The page asks for confirmation before closing with unsaved changes. There is **no image or media viewer**.
- **Go to anything**: a single input "Enter command OR a directory (CD)". The options are the directories from all tabs and histories (existing only) plus all action ids with their labels. The result is either `cd <dir>` or `triggerAction(id)`.
- **Call Action** (F10): input "Enter command" (action ids).
- **Change Dir**: a GE-table tree of subfolders (`POST /api/findfolders`, depth 5), a "Deep" slider and a filter.
- **Selection** (enhance/reduce): a pattern field (see section 3).
- **Config dialogs** (Button, File Type, Tool, Theme, Prompt): Monaco JSON or YAML editors. Theme and Prompt have a name selector, Tool has an OS selector. They save through the matching REST PUT and reset through POST reset.
- **Fancy Theme Editor** (`/themes`, its own window): a table of CSS variables with filter checkboxes (17), a colour-change dialog, an add-variable dialog and a theme name. It saves through the themes API. Live preview is pushed to the main window through the socket (`updateCss` → server → `onCssUpdate` broadcast).
- **Setup** (route): Display Options and Window Behavior with 6 checkboxes from `SetupData` (`openAboutInNewWindow`, `openSetupInNewWindow`, `openServerShellInNewWindow`, `openManageShortcutsInNewWindow`, `loadFolderSizeAfterSelection`, `condensedPresentationStyle`). The defaults are in `assets/setup/data.json`.
- **Server Shell** (route `/shell`): an interactive spawn over the socket (`spawn` / `cancelspawn`) with history.
- **Task manager** (bottom sheet): see section 6.

---

## 6. Task/job queue
`feature/task/*` [read]

- `Queue {status: IDLE|RUNNING|ERROR|PAUSED, actions: QueueActionEvent[], jobId, progress {unfinished, finished, errors, class}, buttonStates {pause, stop, resume, clean}}`. There can be several queues. Index 0 is the main queue; mkdir and createfile use `QUICK_ACTION_QUEUE_INDEX`.
- `QueueActionEvent {panelIndex, filePara: FilePara{source, target, sourcePanelIndex, targetPanelIndex, cmd}, status: PENDING|PROCESSING|ERROR|SUCCESS, id(=jobId group), size, duration, startTime}`. The command types are `copy`, `move`, `remove`, `mkdir`, `createfile`, `rename`, `open`, `unpack`, `pack`, `delempty`, `refresh_panel`, and so on.
- Execution is **strictly sequential**. `next()` picks the first PENDING item and calls `POST /api/do` with the FilePara. The response is a `DirEventIf[]`, which is broadcast through `NotifyService` to the file tables (add, unlink, unselect and so on). On error the item and the queue are set to ERROR and **the queue stops**. Resume is possible.
- Progress only counts actions with `id >= queue.jobId`, which is the latest batch.
- UI: the `Tasks` button with a busy-bee icon and a `finished / total` tooltip. The bottom sheet shows a header with the overall status, info text and a remaining-time estimate (`task-list-calculation.service.ts`, based on historical throughput for copy and move, refreshed every 5 s). The table has the columns Grp(id), Cmd, Status, icon, Duration (a count-up timer while running), File and a delete button (disabled while running). The footer has Clean List, Stop All (removes pending items), Pause and Resume.
- **There is no conflict handling.** The copy and move dialogs do not check whether the target exists, and the backend overwrites [read in copy.fn/move.fn]. There is no per-file progress inside a job.

---

## 7. Backend API (NestJS, prefix `/api`, port 3333; Socket.IO on 3334)
`apps/fnf-api/src/app/**` [read]

**REST**:
- `GET /`, `GET apiPortTest`: the client probes ports `[3333, 3335, 3337, 3339]`. If a second API instance is found, file actions (`/api/do`) are sent to the second port so they run in parallel (`getChangedPort`, `app.config.ts`).
- `GET sysinfo`, `GET firststartfolder`, `GET allinfo`, `GET config`.
- `GET drives`, `POST exists`, `POST checkpath`, `POST filterexists`.
- `POST readdir` (DirPara → DirEvent[]), `POST getfileattributes`, `POST setfileattributes`.
- `POST do` (FilePara → DirEvent[]), `POST do/unpacklist`.
- `GET file?name=` (read text), `POST file?name=` (write text, plain body).
- `POST walkdirsync`, `POST findfolders`, `POST clean`, `POST checkglob`, `POST download` (zip blob).
- `POST shell` (`[{path, cmd, para}]` → `[{stdout, stderr, error}]`, via `exec`), `GET shell-autocomplete`.
- `POST ai/hasopenaiapikey`, `ai/convertnames`, `ai/groupfiles` (OpenAI `gpt-4` by default, or llama3 through Ollama at `localhost:11434`; selected with `FNF_AI_COMPLETION_SERVICE`).
- Config CRUD, which follows one pattern: `GET`, `GET defaults`, `PUT`, `POST reset` for `shortcuts/:os`, `tools/:os`, `buttons`, `filetypes`, `searchpatterns`, `setup`. `themes` and `prompts` additionally have `customnames`, `getdefaultnames`, `:name`, `:name/defaults` and `DELETE :name` (themes only). Custom files go to `assets/<x>/custom/` **inside the app folder**.

**Socket.IO events**:
- `watch` / `unwatch` (DirPara). This uses a chokidar FSWatcher with depth 0 and broadcasts `watching` events (DirEvent with action add|addDir|unlink|unlinkDir|change) to **all** clients.
- `dir` → `dir<rid>`. Lists in batches of 10 000: above that size a `listpreview` is sent first, then per-file events.
- `find` (FindData `{emmitDataKey, emmitCancelKey, dirTabKey, findDialogData}`) → `emmitDataKey` streams of DirEvent `list` with `abs=true` items, plus `cancelfind`. The search uses a synchronous readdir loop and micromatch on the full path. **The `directoriesOnly` option never emits directories** [read, bug].
- `walkdir` / `cancelwalk` (WalkParaData → `WalkDataIf {fileCount, sizeSum, folderCount, last, timestamp}`), limited to a maximum number of concurrent walkers.
- `spawn` / `cancelspawn` (server shell), `getvolumes` → `volumes`, `updateCss` → `onCssUpdate`, `MULTI_DO` → `ON_MULTI_DO_DONE` / `ON_MULTI_DO_ERROR`.

**File operations** (`file-action/action/*.fn.ts`) [read]:
- **copy**: shell commands. macOS `cp -r src targetDir`. Windows `xcopy /E /C /I /H /R /Y` for directories and `xcopy /Y` for files. Linux `rsync -avzh` (with compression, even for local copies). These overwrite silently.
- **move**: macOS `mv`, Windows `robocopy /e /move` (or `robocopy dir dir file /move`), Linux `rsync --remove-source-files` (which leaves empty source directories behind [inferred]). The doc comment mentions a fallback to `fse.move`.
- **remove**: `fse.remove`, which deletes **permanently**. There is **no trash**.
- **mkdir**, **createfile**, **rename**: fs-extra.
- **open**: `open` on macOS, `start "" /max` on Windows, `xdg-open` on Linux [inferred for Linux].
- **pack** / **unpack**: node-7z with 7zip-bin (the binary is chmodded if needed). **unpacklist**: node-stream-zip.
- Each operation returns DirEvents (`checkOrAddDir` for every target path segment, `unselect` for the source, `add`/`addDir`/`unlink*`).

---

## 8. Themes

- `apps/fnf-api/src/assets/color/defaults/`: **bitbucket, blackboard, coffee, combat, cypress, light, norton, paper**. These are exactly the 8 names you listed. I compared them by MD5 of the sorted `colors` object against `files-and-folders-tauri/docs/legacy-themes/*.json`, and **all 8 are identical** [read]. Format: `{name, colors:{"--fnf-…": value}}`. Most themes have 76 variables; coffee has 72 and norton 71. Primary colour: #0098db, except cypress (#04c38e).
- The 76 variables: `activepanel-header-{bg,border,selected-tab-bg,selected-tab-fg}-color`, `activepanel-table-{header-bg,selected-row-bg,selected-row-fg,bg,border,fg}-color`, `footer-{bg,button-bg,button-border,button-fg,fg,error-fg,shortcut-bg,shortcut-fg}-color`, `error-panel-{fg,bg}-color`, `header-{bg,border,fg}-color`, `header-input-{background-color,border,color}`, `header-selected-tab-{bg,fg}-color`, `scrollbar-{thumb-active-bg,thumb-bg,thumb-border,track-bg}-color`, `table-{bg,border,fg,focused-row-bg,focused-row-fg,header-bg,header-fg,hover-row-bg,selected-row-bg,selected-row-fg}-color`, `table-font-size`, `tooltip-{bg,background-input,color,input}-color`, `material-{accent,primary,secondary,warn,unthemed}-color`, `dialog-{primary,secondary,input}-{fg,bg,border}-color`, `dialog-button-{primary,secondary,accent,warn,unthemed}-{fg,bg,border}-color` (all prefixed `--fnf-`).
- Fallback defaults are in `apps/fnf/src/css/fnf-css-custom-properties.css` (`:root`). The mapping to GE table variables is in `file-table.component.global.css`: `--ge-table-*` is bound to `--fnf-table-*`. In the active panel `--ge-table-body-center-bg` is `--fnf-activepanel-table-bg-color`. **Selected rows use only a coloured foreground** (`--fnf-(activepanel-)table-selected-row-fg-color`, #e00034 red in light) on the normal background. The **focused row** uses `--fnf-table-focused-row-bg-color` (primary) with the table background as text colour, and **only in the active panel**. The inactive panel shows no cursor [read].
- Applying a theme (`look-and-feel.service.ts`): `GET /api/themes/:name`, then `documentElement.style.setProperty(key, value)` for every variable, the theme name as a `body` class, the attribute `favs-theme`, and meta `theme-color`. The theme is persisted in localStorage `theme`. **There is no light/dark flag in the theme files** and Material is not switched to a dark scheme [read]. The GE table's `html[data-theme=dark]` block is never activated [inferred].
- The custom CSS "socket sync" (`updateCss`) exists only to push changes from the theme editor window into the main window.

---

## 9. Config and setup files
- **tool/defaults/{os}.json** `CmdIf[] {id, label, shortcut, cmd, para, fileLimit?, local}`:
  - macOS: CMD_EDIT_FILE `code $file` (`ctrl shift 4`), CMD_SHELL `open -a Terminal $dir` (`cmd 0`), CMD_REVEAL_IN_FINDER `open $dir` (`cmd shift f`).
  - Linux: the same, but `$clidir/linux-open-terminal.sh` and `control 4`.
  - Windows: CMD_EDIT_FILE `f4`, CMD_7ZIP `7z` (`control shift z`), CMD_SHELL `$clidir\windows-open-terminal.bat` (`control alt c`).
  - `$file` and `$dir` are substituted per selected item, and the result is posted to `/api/shell`. `$clidir` points to `assets/scripts` [inferred].
- **filetype/defaults/data.json** `[{label, extensions[]}]`: movies, audio, images, documents, archives, code, executables, fonts, ebooks, design, 3d. Used by the selection dialog (select by type). **Not used for icons.**
- **search/defaults/data.json**: the same shape, with the extra entries "movies & images" and "ebooks & covers". Used for find pattern templates. The paths for defaults and custom are **swapped** in `environment.ts` (`searchPatternCustomPath = …/search/defaults`) [read, bug].
- **prompt/defaults/*.yaml** `{description, prompt}`:
  - `convert_filenames`: normalise media names, for example `TITLE (yyyy).ext`, `SHOW - SxxEyy - TITLE.ext`, returned as a JSON map.
  - `group_filenames`: TV series into `/{TITLE}/{Snn}/{Snn}{Enn} - {EPISODE}.{EXT}`.
- **setup/data.json**: the 6 flags listed above (`openAboutInNewWindow: true` and so on).

---

## 10. Electron desktop
`apps/fnf-desktop` [read]

- `electron-main/main.ts`: loads `.env`. Creates a 1280×800 `BrowserWindow` that loads `FNF_DEV_SERVER_URL` (dev) or the copied renderer `index.html`. Sets a CSP. Registers `fnf-local://` (unused) and **global** DevTools shortcuts (`Cmd+Alt+I`, `F12`) with `globalShortcut`. These are system-wide, and F12 collides with app keys [inferred]. It also starts a local HTTP helper on 127.0.0.1:4765 (`/app/version`, `/app/open-external`, `/api/request` proxy to `FNF_API_URL` = localhost:3333).
- **It does not start the NestJS API.** The API must run separately [inferred: no spawn or fork in main.ts].
- Preload bridge `window.bridge = { getVersion(), openExternal(url), apiRequest({method,path,headers,body}) (zod-validated, IPC 'api:request'), util.fixPath(s) }`. **The Angular app never uses `window.bridge`** (grep finds nothing) [read].

**Browser- or Docker-only parts that are obsolete for a desktop app**: dockerRoot, containerPaths and the `DockerRootDeletePipe`; the "Download" dialog (blob download); multi-port API probing; Socket.IO broadcast to all clients; config stored inside the app's `assets` folder; `window.open` for the editor and theme windows plus the localStorage handover; the Server Shell page (in a desktop app it is simply a local shell); the `/api/file` text endpoints; the fullscreen button using the browser Fullscreen API; the custom-CSS socket sync.

---

## 11. Bugs/TODOs and recommendations

**Notable bugs** (the first two are inferred, the rest read):
1. Shortcut matching depends on the order of modifiers in the raw JSON keys. Combos written as `cmd+alt+…`, `ctrl+delete`, `ctrl+alt+plus` and all tool shortcuts never fire. **Fix**: normalise both sides into a canonical form, for example a sorted modifier set plus `KeyboardEvent.code`.
2. `cmd` is mapped to Meta on Windows and Linux, so dozens of Windows defaults need the Windows key.
3. There is no Ctrl button set, `alt` is not rendered as ⌥, and there is no plain F7 for mkdir.
4. `document.title` is overwritten by the ngDoCheck counter.
5. Dead actions, including Find duplicates. `NAVIGATE_LEVEL_DOWN` is labelled "Parent Dir", which is confusing.
6. `setFileItemSelected` only sets the flag when `meta` is missing.
7. Find with `directoriesOnly` returns nothing, and find blocks the event loop.
8. Copy and move have no conflict handling and overwrite silently. Delete is permanent. Linux copy uses `rsync -z`.
9. The search config paths are swapped. Multi-rename shows step "50" but uses 30. The extension regex `.rarp` is a typo for `.rar`.
10. Sort state is reset to name ascending on every start. The splitter position is not persisted.
11. The 50/50 value lacks `calc()` (invalid in `max-width`). Arrow navigation runs on keyup, so there is no auto-repeat.
12. The tab context menu and the history menu are both wired to long press. The shell panel TODO for up/down history and Esc is still open.

**Keep** (behaviour to replicate 1:1):
- The 6-row grid with a shared splitter and double-click for 50/50.
- Breadcrumb with fav toggle.
- Tab bar with favs/latest/drives menu, context menu, history, filter and hidden-files toggles.
- File table on GE with the same options: own selection and focus models, `shortcutActionsDisabled`, 34 px rows, the 4 columns and renderers, `..` and directories first.
- The summary label format.
- The button bar with modifier sets, shortcut badges and the 4-column Actions menu.
- The task queue UI.
- Per-directory selection and focus memory.
- The quick-search prefix.
- The mkdir sequence suggestion.
- Multi rename with macros, multi mkdir and group files.
- Zip browsing via `file.zip:`.
- The 8 themes, used as-is through `--fnf-*` variables.
- All config shapes: buttons, tools, filetypes, search patterns, prompts, setup.

**Modernise**:
- Replace REST and Socket.IO with Tauri `invoke` and `Channel`/events. Directory listing, watching (the `notify` crate), find and walk (`walkdir`/`ignore`/`globset`, run asynchronously and cancellable) become Rust commands that stream `DirEvent`-shaped payloads, so the table logic can stay the same.
- Implement copy and move natively in Rust with byte progress, conflict prompts (overwrite/skip/rename/all) and cancellation. Use the `trash` crate for delete with an option for permanent delete. Keep a sequential queue but allow parallel queues.
- Store config in `app_config_dir()` as defaults plus a **merged** override, not a wholesale replacement. Keep UI state either in localStorage or in a `tauri-plugin-store` file.
- Use one canonical shortcut format with per-OS mapping (`mod` = Cmd on macOS, Ctrl elsewhere), handled on keydown with repeat for navigation. Add a Ctrl button set.
- Open the viewer/editor in a Tauri `WebviewWindow` or an in-app dialog (Monaco), and add an image/PDF/media preview.
- Add a dark-mode flag to themes (Material `color-scheme`, GE `data-theme`).
- Move icon mapping to the filetype config, or keep it as one table in the code.
- Pack and unpack with `sevenz-rust`/`zip`, or a bundled 7z sidecar.
- Use the `open` crate (or `tauri-plugin-opener`) for "open with default app" and "reveal in Finder".
- Make the AI features optional, with the key stored in the OS keychain.

**Drop**:
- Docker root and container paths, the download dialog, multi-port probing, the Electron HTTP helper and bridge, the global DevTools shortcuts, the custom-CSS socket sync (use Tauri events between windows instead), the debug title counter and the bug button, and the dead action ids. Also drop the Server Shell page; the footer shell panel is enough, or a later PTY (`portable-pty`).
