# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An Obsidian plugin. It registers a `hexcrawl` markdown code-block processor that renders a folder of notes (each with `hex-q`/
`hex-r` frontmatter) as a pannable/zoomable hex map, editable in place via a toolbar that writes straight back to the notes' frontmatter.

## Commands

```bash
npm run dev            # esbuild watch build
npm run build           # typecheck (tsc -noEmit) + production esbuild build
npm test                # vitest run (all tests)
npx vitest run tests/hexGeometry.test.ts   # single test file
npx vitest run -t "some test name"         # single test by name
npm run typecheck       # tsc -noEmit -skipLibCheck
npm run lint            # eslint .
npm run format           # prettier --write .
npm run format:check     # prettier --check .
```

`pre-commit install` wires typecheck/lint/format-check as pre-commit hooks (same checks as CI in
`.github/workflows/ci.yml`). Never bypass these with `--no-verify`; fix the reported issue and
recommit. `main.js` is the esbuild output — never hand-edit it, and it's excluded from lint/prettier.

Releases: `npm run version` bumps `manifest.json`/`versions.json` (this is the standard
`npm version` hook, so it's invoked by `npm version <bump>`, not run directly); pushing a tag
triggers `.github/workflows/release.yml`, which builds and asserts the tag matches
`manifest.json`'s version before publishing `main.js`, `manifest.json`, `styles.css`.

## Working conventions

- After any source change, rebuild (`npm run dev` or `npm run build`) so `main.js` stays
  up-to-date — the user runs the plugin from that compiled output, not the TypeScript source.
- Run `npm run format` (or `format:check`) on changed files before considering a change done.
- Keep comments compact — state the non-obvious reason in one line, not a paragraph.
- Tighten any existing comment you touch that over-explains.

## Architecture

### Entry point and data flow

`main.ts` registers the `hexcrawl` code-block processor. Each render: `params.ts`
(`parseHexcrawlParams`) validates the block's YAML into a `HexcrawlBlockParams`, resolving a
named palette against plugin settings (or accepting an inline one); on success a
`HexMapRenderer` (`src/render/HexMapRenderer.ts`) is constructed and told to `render()`.

There is no fixed hex schema beyond `hex-q`/`hex-r` — `hex-terrain`, `hex-icon`, `hex-gm-icon`
are just the fields this plugin's tools happen to read/write (via `dataLoaders.ts` /
`frontmatter.ts`), and a note is free to carry other frontmatter untouched.

### HexMapRenderer: the orchestrator

`HexMapRenderer` owns the loaded `hexNotes` map, the `Toolbar`, `UndoManager`, and every
layer/tool, and is the only place that writes hex-note frontmatter. Its `buildGrid()` mounts
layers in a fixed bottom-to-top stacking order — terrain colors, borders, paths, icons, GM icons
— so nothing crossing a hex ever paints over a layer above it; `BorderTool.mountOverlay` is
mounted last so its editing affordances always sit on top. `PanZoom.ts` drives pan/zoom/click
routing on the clip element and is tool-agnostic — it just decides paint-mode vs. drag-to-pan vs.
plain click and calls back into `HexMapRenderer`.

Every layer/tool implements an incremental update API (`render()` for a full pass, `updateHex(q,
r, note)` for one hex) so an edit patches the live DOM instead of re-rendering the whole grid —
this is what keeps pan/zoom/tool state intact across edits.

Hex-note writes always go through `HexMapRenderer.writeHexField` /`applyFieldValue`
(`processFrontMatter` for an existing note, `vault.create` for a previously-unconfigured hex,
naming new notes `_r{r}_q{q}.md`) and are bundled into a single `UndoManager` action per
user-perceived gesture (one click, a whole brush drag-stroke, a whole bucket fill, a whole
icon-move) — undo reverses each field write and deletes a note the action created if nothing else
configures it.

### Tools vs. layers

Path and Border are the two tools complex enough to own their own state machine (idle/drawing/
editing, "picking-first" for a border's first edge, etc.) plus their own note list — `PathTool`/
`BorderTool` own that logic and delegate SVG drawing to a paired `PathLayer`/`BorderLayer`.
Brush/Bucket/Icon/GM Icon have no dedicated Tool class: `Toolbar.drawerSelection` (the picked
palette value, eraser, or Move) plus `HexMapRenderer.runTool`/`paintAt` is enough. `TerrainLayer`'s
hex `<div>`s (with `data-q`/`data-r`) double as the click hit-targets every tool/paint routine
hit-tests against, since icon/path/border layers render with `pointer-events: none` by default.

Icon dragging (Move mode in the Icon/GM Icon drawer) is the one place an icon element itself
becomes interactive: it gets a local `pointerdown`/`pointermove`/`pointerup` handler (mirroring
`PathLayer`'s marker-drag pattern) that `stopPropagation()`s so it doesn't also trigger
`PanZoom`'s pan/click handling.

`Toolbar` (`src/render/Toolbar.ts`) owns tool selection and the bottom drawer, and exposes hooks
(`onToolChange`, `onDrawerSelectionChange`, `populate*Drawer`) so `HexMapRenderer` can react
without `Toolbar` knowing about any tool's internals.

### Geometry, palette, and data modules

- `src/render/hexGeometry.ts` / `src/render/borderGeometry.ts`: pure hex-grid math (pointy/flat
  orientation, odd/even stagger, neighbors, centers, edge geometry) — no DOM/Obsidian
  dependencies, which is why these are the modules with real unit test coverage.
- `src/palette.ts`: resolves a hex/path/border's effective color/icon from its note plus the
  active palette, with fallbacks (e.g. `hex-icon` overrides the palette's terrain-derived icon;
  an unmatched `hex-terrain`/`path-type`/`border-type` is used directly as a literal CSS color).
  `hex-gm-icon` has no palette fallback — it only renders when a note sets it explicitly.
- `src/dataLoaders.ts` / `src/frontmatter.ts`: read/validate hex/path/border notes' frontmatter
  into `HexNoteData`/`PathData`/`BorderData`, and resolve a palette's effective icon set (the
  bundled pack in `src/bundledIcons.ts`, or _only_ a configured `iconsFolder` — never both mixed).
  Border notes that fail structural or adjacency/head-to-tail validation are skipped with a
  logged error plus a user-facing `Notice`; malformed path-hexes are silently skipped.
- `src/settings/`: named palettes are persisted vault-wide via plugin settings
  (`settings.ts`/`SettingsTab.ts`/`PaletteEditModal.ts`); a code block can reference one by name
  or define an inline palette scoped to that block.

### Testing

`vitest` covers the pure-logic modules only (`hexGeometry`, `borderGeometry`, `frontmatter`,
`naming`, `palette`, `pathStyle`) — there's no Obsidian API mock, so DOM/plugin-facing code
(`src/render/*Layer.ts`, `*Tool.ts`, `Toolbar.ts`, `HexMapRenderer.ts`) isn't unit tested; verify
those by running the plugin in an actual vault.
