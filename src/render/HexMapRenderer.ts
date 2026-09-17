import {
	App,
	MarkdownPostProcessorContext,
	normalizePath,
	Platform,
	TFolder,
} from "obsidian";
import type { HexCoord, HexcrawlBlockParams, HexNoteData } from "../types";
import {
	gridBoundingBox,
	hexCenter,
	hexKey,
	hexNeighbors,
} from "./hexGeometry";
import { loadHexNotes } from "../dataLoaders";
import { resolveIconsFolder } from "../palette";
import { setupPanAndZoom } from "./PanZoom";
import { createDrawerToggleItem, Toolbar } from "./Toolbar";
import type { DrawerSelection, ToolKind } from "./Toolbar";
import { PathTool } from "./PathTool";
import { BorderTool } from "./BorderTool";
import { TerrainLayer } from "./TerrainLayer";
import { IconsLayer } from "./IconsLayer";
import { GmIconsLayer } from "./GmIconsLayer";
import { UndoManager } from "./UndoManager";
import type { UndoableAction } from "./UndoManager";

const MIN_GUTTER = 20;

type HexNoteField = "hex-terrain" | "hex-icon" | "hex-gm-icon";

/** One field write applied to a hex note, with enough of its prior state to reverse it. */
interface FieldMutation {
	q: number;
	r: number;
	field: HexNoteField;
	prevValue: string | undefined;
	newValue: string | undefined;
	/** Whether the hex already had a note before this write — if not, this write created it,
	 *  and undoing it may need to delete that note again rather than just clearing a field. */
	noteExistedBefore: boolean;
}

/** Reads the note property a given frontmatter field maps to — shared by patch() and the
 *  "does this note have any other configured field" check in revertFieldMutation(). */
const FIELD_ACCESSORS: Record<
	HexNoteField,
	(note: HexNoteData) => string | undefined
> = {
	"hex-terrain": (note) => note.terrain,
	"hex-icon": (note) => note.icon,
	"hex-gm-icon": (note) => note.gmIcon,
};

/** Narrows away DrawerSelection's Move variant — brush/bucket never offer it, but the type is
 *  shared across every tool's drawer. */
function isPaintSelection(
	selection: DrawerSelection,
): selection is { erase: true } | { erase: false; value: string } {
	return !("move" in selection);
}

export class HexMapRenderer {
	private folder: TFolder | null = null;
	private hexNotes = new Map<string, HexNoteData>();
	/** Hex keys with a note-creation currently in flight, so a double-click on the same
	 *  unconfigured hex can't race two vault.create() calls onto the same new file path. */
	private pendingCreates = new Set<string>();
	/** Hex key last painted by the current brush drag gesture, so dragging across a hex
	 *  doesn't re-fire the write on every pointermove while the pointer sits over it. */
	private lastPaintedKey: string | null = null;
	/** Mutations from the current brush drag-stroke, collected so the whole stroke undoes
	 *  as one step instead of one step per hex. */
	private strokeMutationPromises: Promise<FieldMutation | null>[] = [];

	private toolbar: Toolbar;
	private pathTool: PathTool;
	private borderTool: BorderTool;
	private terrainLayer: TerrainLayer;
	private iconsLayer: IconsLayer;
	private gmIconsLayer: GmIconsLayer;
	private undoManager = new UndoManager();

	constructor(
		private app: App,
		private container: HTMLElement,
		private params: HexcrawlBlockParams,
		private ctx: MarkdownPostProcessorContext,
	) {
		this.toolbar = new Toolbar(app, params, {
			onToolChange: () => {
				this.pathTool.reset();
				this.borderTool.reset();
			},
			onDrawerSelectionChange: (selection) => {
				const moveActive = !!selection && "move" in selection;
				this.iconsLayer.setDragEnabled(
					moveActive && this.toolbar.activeTool === "icon",
				);
				this.gmIconsLayer.setDragEnabled(
					moveActive && this.toolbar.activeTool === "gm-icon",
				);
			},
			populatePathDrawer: (scrollEl) => this.pathTool.populateDrawer(scrollEl),
			populateBorderDrawer: (scrollEl) =>
				this.borderTool.populateDrawer(scrollEl),
			populateLayersDrawer: (scrollEl) => this.populateLayersDrawer(scrollEl),
		});
		this.pathTool = new PathTool(
			app,
			params,
			() => this.toolbar.refreshDrawer(),
			this.undoManager,
		);
		this.borderTool = new BorderTool(
			app,
			params,
			() => this.toolbar.refreshDrawer(),
			this.undoManager,
		);
		this.terrainLayer = new TerrainLayer(params);
		this.iconsLayer = new IconsLayer(
			app,
			params,
			(fromQ, fromR, toQ, toR) =>
				void this.moveIconField("hex-icon", fromQ, fromR, toQ, toR),
		);
		this.gmIconsLayer = new GmIconsLayer(
			app,
			params,
			(fromQ, fromR, toQ, toR) =>
				void this.moveIconField("hex-gm-icon", fromQ, fromR, toQ, toR),
		);
	}

	render(): void {
		this.container.empty();
		this.container.addClass("hexcrawl-block");

		const folder = this.app.vault.getAbstractFileByPath(
			normalizePath(this.params.folder),
		);
		if (!(folder instanceof TFolder)) {
			this.container.createEl("pre", {
				text: `hexcrawl: folder not found: "${this.params.folder}"`,
			});
			return;
		}

		this.folder = folder;
		this.hexNotes = loadHexNotes(this.app, folder);
		this.buildGrid();
	}

	private buildGrid(): void {
		const {
			orientation,
			stagger,
			hexSize: radius,
			cols,
			rows,
			height,
			showCoords,
			pathsFolder,
			bordersFolder,
		} = this.params;
		const pathsFolderObj = pathsFolder
			? this.app.vault.getAbstractFileByPath(normalizePath(pathsFolder))
			: undefined;
		this.pathTool.load(
			pathsFolderObj instanceof TFolder ? pathsFolderObj : null,
		);
		const bordersFolderObj = bordersFolder
			? this.app.vault.getAbstractFileByPath(normalizePath(bordersFolder))
			: undefined;
		this.borderTool.load(
			bordersFolderObj instanceof TFolder ? bordersFolderObj : null,
		);

		const clipEl = this.container.createDiv({
			cls: "hexcrawl-clip",
			attr: { tabindex: "0" },
		});
		clipEl.style.height = `${height}px`;
		clipEl.addEventListener("keydown", (e) => this.handleUndoRedoKey(e));
		const viewportEl = clipEl.createDiv({ cls: "hexcrawl-viewport" });
		this.toolbar.mount(clipEl);

		const gutter = showCoords ? Math.max(MIN_GUTTER, radius * 0.6) : 0;
		const bbox = gridBoundingBox(cols, rows, orientation, radius, stagger);
		const totalSize = {
			width: bbox.width + gutter,
			height: bbox.height + gutter,
		};
		viewportEl.style.width = `${totalSize.width}px`;
		viewportEl.style.height = `${totalSize.height}px`;

		// Stacking order, bottom to top: terrain colors, then borders, then paths, then icons,
		// then GM icons — each renders after the last (and so on top of it) so nothing crossing
		// a hex ever paints over what's above it. GM icons are topmost, above everything.
		this.terrainLayer.mount(viewportEl);
		this.terrainLayer.render(this.hexNotes, gutter);

		this.borderTool.mount(viewportEl, gutter, totalSize);

		this.pathTool.mount(viewportEl, gutter, totalSize);

		this.iconsLayer.mount(viewportEl, totalSize);
		void this.iconsLayer.load(resolveIconsFolder(this.params)).then(() => {
			this.iconsLayer.render(this.hexNotes, gutter);
		});

		this.gmIconsLayer.mount(viewportEl, totalSize);
		void this.gmIconsLayer.load().then(() => {
			this.gmIconsLayer.render(this.hexNotes, gutter);
		});

		// Mounted last so its editing-only affordances (add-edge dots, end-removal hitareas)
		// always paint on top of paths/icons, regardless of where on the grid they fall.
		this.borderTool.mountOverlay(viewportEl, totalSize);

		if (showCoords)
			this.renderAxisLabels(
				viewportEl,
				orientation,
				radius,
				cols,
				rows,
				gutter,
			);

		setupPanAndZoom(
			this.container,
			this.ctx,
			clipEl,
			viewportEl,
			totalSize,
			(e) => this.handleClick(e),
			() =>
				this.toolbar.activeTool === "brush" &&
				this.toolbar.drawerSelection !== null,
			(e) => this.paintAt(e),
			() => void this.endPaintStroke(),
		);
	}

	/**
	 * Undo is Cmd+Z / redo Cmd+Shift+Z on macOS (its OS-standard shortcuts); Ctrl+Z / Ctrl+Y
	 * elsewhere. Scoped to clipEl (focused on every pointerdown inside the map) rather than
	 * the document, so it doesn't fight with Obsidian's own editor undo while a note is open.
	 */
	private handleUndoRedoKey(e: KeyboardEvent): void {
		const key = e.key.toLowerCase();
		if (key !== "z" && key !== "y") return;

		const isUndo = Platform.isMacOS
			? e.metaKey && !e.shiftKey && key === "z"
			: e.ctrlKey && !e.shiftKey && key === "z";
		const isRedo = Platform.isMacOS
			? e.metaKey && e.shiftKey && key === "z"
			: e.ctrlKey && key === "y";
		if (!isUndo && !isRedo) return;

		e.preventDefault();
		e.stopPropagation();
		void (isUndo ? this.undoManager.undo() : this.undoManager.redo());
	}

	private renderAxisLabels(
		viewportEl: HTMLElement,
		orientation: HexcrawlBlockParams["orientation"],
		radius: number,
		cols: number,
		rows: number,
		gutter: number,
	): void {
		for (let q = 0; q < cols; q++) {
			const x =
				gutter + hexCenter(q, 0, orientation, radius, this.params.stagger).cx;
			const labelEl = viewportEl.createDiv({
				cls: "hexcrawl-axis-label",
				text: String(q),
			});
			labelEl.style.left = `${x}px`;
			labelEl.style.top = `${gutter / 2}px`;
		}
		for (let r = 0; r < rows; r++) {
			const y =
				gutter + hexCenter(0, r, orientation, radius, this.params.stagger).cy;
			const labelEl = viewportEl.createDiv({
				cls: "hexcrawl-axis-label",
				text: String(r),
			});
			labelEl.style.left = `${gutter / 2}px`;
			labelEl.style.top = `${y}px`;
		}
	}

	/** Layers tool's drawer: one toggle per layer, independent of one another (not single-select). */
	private populateLayersDrawer(scrollEl: HTMLElement): void {
		const layers = [
			this.terrainLayer,
			this.borderTool,
			this.pathTool,
			this.iconsLayer,
			this.gmIconsLayer,
		] as const;
		const labels = [
			"Terrain",
			"Borders",
			"Paths",
			"Icons",
			"GM Icons",
		] as const;
		layers.forEach((layer, i) => {
			createDrawerToggleItem(
				scrollEl,
				labels[i],
				() => layer.isVisible,
				() => layer.setVisible(!layer.isVisible),
			);
		});
	}

	/**
	 * With a tool active, a click paints/erases/fills the clicked hex (or drives the Path
	 * tool's own state machine) instead of opening any note — editing mode fully replaces
	 * the browsing-mode click behavior.
	 */
	private handleClick(e: PointerEvent): void {
		// e.target isn't usable here: clipEl holds pointer capture (for dragging),
		// which retargets it to clipEl itself — an ancestor of every hex/path, so
		// closest() on it can never find them. elementFromPoint isn't affected.
		const hit = document.elementFromPoint(e.clientX, e.clientY);
		if (!hit) return;

		const activeTool = this.toolbar.activeTool;

		if (activeTool === "path") {
			this.pathTool.handleClick(hit);
			return;
		}

		if (activeTool === "border") {
			this.borderTool.handleClick(hit, { x: e.clientX, y: e.clientY });
			return;
		}

		if (activeTool) {
			const hexEl = hit.closest(".hexcrawl-hex");
			if (!(hexEl instanceof HTMLElement)) return;
			const q = Number(hexEl.getAttribute("data-q"));
			const r = Number(hexEl.getAttribute("data-r"));
			if (!Number.isInteger(q) || !Number.isInteger(r)) return;
			void this.runTool(q, r, activeTool, this.toolbar.drawerSelection);
			return;
		}

		const el = hit.closest("[data-note-path]");
		if (!el) return;

		// A hex cell carries the attribute directly, and its own hexNotes entry always holds a
		// live TFile — resolving through the grid coordinates rather than the (possibly stale,
		// if the note was renamed since the last render) path string on the element itself.
		const hexEl = el.closest(".hexcrawl-hex");
		if (hexEl instanceof HTMLElement) {
			const q = Number(hexEl.getAttribute("data-q"));
			const r = Number(hexEl.getAttribute("data-r"));
			const note =
				Number.isInteger(q) && Number.isInteger(r)
					? this.hexNotes.get(hexKey(q, r))
					: undefined;
			if (note) void this.app.workspace.getLeaf(true).openFile(note.file);
			return;
		}

		// Otherwise it's a path/border line — look up its live TFile via the owning tool's list.
		const notePath = el.getAttribute("data-note-path");
		const file = notePath
			? (this.pathTool.findFile(notePath) ?? this.borderTool.findFile(notePath))
			: undefined;
		if (file) void this.app.workspace.getLeaf(true).openFile(file);
	}

	/**
	 * Brush drag-paint: fires on pointerdown and every pointermove while the brush tool is
	 * active, painting each new hex the pointer crosses into (deduped against the last
	 * painted hex so holding still over one hex doesn't re-fire the write). Mutations are
	 * collected rather than pushed to the undo stack immediately — endPaintStroke() bundles
	 * the whole drag into a single undo step once the pointer is released.
	 */
	private paintAt(e: PointerEvent): void {
		if (e.type === "pointerdown") {
			this.lastPaintedKey = null;
			this.strokeMutationPromises = [];
		}

		const hit = document.elementFromPoint(e.clientX, e.clientY);
		if (!hit) return;
		const hexEl = hit.closest(".hexcrawl-hex");
		if (!(hexEl instanceof HTMLElement)) return;
		const q = Number(hexEl.getAttribute("data-q"));
		const r = Number(hexEl.getAttribute("data-r"));
		if (!Number.isInteger(q) || !Number.isInteger(r)) return;

		const key = hexKey(q, r);
		if (key === this.lastPaintedKey) return;
		this.lastPaintedKey = key;

		const selection = this.toolbar.drawerSelection;
		if (!selection || !isPaintSelection(selection)) return;
		this.strokeMutationPromises.push(
			this.writeHexField(
				q,
				r,
				"hex-terrain",
				selection.erase ? undefined : selection.value,
			),
		);
	}

	/** Bundles the current brush drag-stroke's mutations into a single undo step. */
	private async endPaintStroke(): Promise<void> {
		const promises = this.strokeMutationPromises;
		this.strokeMutationPromises = [];
		const mutations = (await Promise.all(promises)).filter(
			(m): m is FieldMutation => m !== null,
		);
		if (mutations.length > 0)
			this.undoManager.push(this.makeFieldAction(mutations));
	}

	private async runTool(
		q: number,
		r: number,
		activeTool: Exclude<ToolKind, "path" | "border">,
		selection: DrawerSelection | null,
	): Promise<void> {
		if (!selection) return;

		switch (activeTool) {
			case "brush": {
				if (!isPaintSelection(selection)) break;
				const m = await this.writeHexField(
					q,
					r,
					"hex-terrain",
					selection.erase ? undefined : selection.value,
				);
				if (m) this.undoManager.push(this.makeFieldAction([m]));
				break;
			}
			case "icon": {
				if (!isPaintSelection(selection)) break; // moving is done by dragging the icon itself
				const m = await this.writeHexField(
					q,
					r,
					"hex-icon",
					selection.erase ? undefined : selection.value,
				);
				if (m) this.undoManager.push(this.makeFieldAction([m]));
				break;
			}
			case "gm-icon": {
				if (!isPaintSelection(selection)) break; // moving is done by dragging the icon itself
				const m = await this.writeHexField(
					q,
					r,
					"hex-gm-icon",
					selection.erase ? undefined : selection.value,
				);
				if (m) this.undoManager.push(this.makeFieldAction([m]));
				break;
			}
			case "bucket":
				if (!isPaintSelection(selection)) break;
				if (!selection.erase) await this.bucketFill(q, r, selection.value);
				break;
			case "layers":
				break; // Layers tool has no per-hex click effect.
			default:
				activeTool satisfies never;
		}
	}

	/** Flood-fills the contiguous region of hexes sharing the clicked hex's current hex-terrain,
	 *  as a single undo step. */
	private async bucketFill(q: number, r: number, value: string): Promise<void> {
		const { cols, rows, orientation, stagger } = this.params;
		const startTerrain = this.hexNotes.get(hexKey(q, r))?.terrain;

		const visited = new Set<string>();
		const stack: HexCoord[] = [{ q, r }];
		const region: HexCoord[] = [];

		while (stack.length > 0) {
			const cur = stack.pop()!;
			if (cur.q < 0 || cur.q >= cols || cur.r < 0 || cur.r >= rows) continue;
			const key = hexKey(cur.q, cur.r);
			if (visited.has(key)) continue;
			visited.add(key);
			if (this.hexNotes.get(key)?.terrain !== startTerrain) continue;
			region.push(cur);
			for (const n of hexNeighbors(cur.q, cur.r, orientation, stagger)) {
				if (!visited.has(hexKey(n.q, n.r))) stack.push(n);
			}
		}

		const mutations = (
			await Promise.all(
				region.map((cell) =>
					this.writeHexField(cell.q, cell.r, "hex-terrain", value),
				),
			)
		).filter((m): m is FieldMutation => m !== null);
		if (mutations.length > 0)
			this.undoManager.push(this.makeFieldAction(mutations));
	}

	/**
	 * Applies a field write and returns enough of its prior state to undo it later — or null
	 * if the value didn't actually change (nothing to undo). Doesn't touch the undo stack
	 * itself: callers batch mutations (a whole brush stroke, a whole bucket fill) into one
	 * undo step before pushing.
	 */
	private async writeHexField(
		q: number,
		r: number,
		field: HexNoteField,
		value: string | undefined,
	): Promise<FieldMutation | null> {
		const key = hexKey(q, r);
		const existing = this.hexNotes.get(key);
		const prevValue = existing && FIELD_ACCESSORS[field](existing);
		if (prevValue === value) return null;
		await this.applyFieldValue(q, r, field, value);
		return {
			q,
			r,
			field,
			prevValue,
			newValue: value,
			noteExistedBefore: !!existing,
		};
	}

	/**
	 * Moves an icon/gm-icon field's explicit value from one hex to another — clearing it at the
	 * source and setting it at the target — as a single undo step. No-op if the source hex has
	 * no explicit value for `field` (only reachable via a bug in the drag gesture, since the
	 * layers only make an icon draggable once it has one) or if source and target are the same.
	 */
	private async moveIconField(
		field: "hex-icon" | "hex-gm-icon",
		fromQ: number,
		fromR: number,
		toQ: number,
		toR: number,
	): Promise<void> {
		if (fromQ === toQ && fromR === toR) return;
		const fromNote = this.hexNotes.get(hexKey(fromQ, fromR));
		const value = fromNote && FIELD_ACCESSORS[field](fromNote);
		if (value === undefined) return;

		const clearMutation = await this.writeHexField(
			fromQ,
			fromR,
			field,
			undefined,
		);
		const setMutation = await this.writeHexField(toQ, toR, field, value);
		const mutations = [clearMutation, setMutation].filter(
			(m): m is FieldMutation => m !== null,
		);
		if (mutations.length > 0)
			this.undoManager.push(this.makeFieldAction(mutations));
	}

	/**
	 * Sets or clears one frontmatter field on the hex note at (q, r) — updating the existing
	 * note via processFrontMatter, or creating a new "_r{r}_q{q}.md" note if the hex was
	 * previously unconfigured (clearing an already-empty hex is a no-op: nothing to create).
	 * Patches the live DOM in place afterward rather than re-rendering the whole map, so pan/
	 * zoom/tool state survives.
	 */
	private async applyFieldValue(
		q: number,
		r: number,
		field: HexNoteField,
		value: string | undefined,
	): Promise<void> {
		const key = hexKey(q, r);
		const existing = this.hexNotes.get(key);
		const patch = (base: {
			terrain?: string;
			icon?: string;
			gmIcon?: string;
		}) => ({
			terrain: field === "hex-terrain" ? value : base.terrain,
			icon: field === "hex-icon" ? value : base.icon,
			gmIcon: field === "hex-gm-icon" ? value : base.gmIcon,
		});

		if (existing) {
			await this.app.fileManager.processFrontMatter(
				existing.file,
				(fm: Record<string, unknown>) => {
					if (value === undefined) delete fm[field];
					else fm[field] = value;
				},
			);
			const updated: HexNoteData = { ...existing, ...patch(existing) };
			this.hexNotes.set(key, updated);
			this.terrainLayer.updateHex(q, r, updated);
			this.iconsLayer.updateHex(q, r, updated);
			this.gmIconsLayer.updateHex(q, r, updated);
			return;
		}

		if (value === undefined || !this.folder) return;
		if (this.pendingCreates.has(key)) return;
		this.pendingCreates.add(key);
		try {
			const path = normalizePath(`${this.folder.path}/_r${r}_q${q}.md`);
			const content = `---\nhex-q: ${q}\nhex-r: ${r}\n${field}: ${JSON.stringify(value)}\n---\n`;
			const file = await this.app.vault.create(path, content);
			const created: HexNoteData = {
				file,
				name: file.basename,
				...patch({}),
			};
			this.hexNotes.set(key, created);
			this.terrainLayer.updateHex(q, r, created);
			this.iconsLayer.updateHex(q, r, created);
			this.gmIconsLayer.updateHex(q, r, created);
		} finally {
			this.pendingCreates.delete(key);
		}
	}

	/**
	 * Reverses one mutation for undo. If the mutation created the note (it didn't exist
	 * before), clearing the field again may leave the note fully unconfigured — in that case
	 * the note is deleted outright, matching the hex's true prior state.
	 */
	private async revertFieldMutation(m: FieldMutation): Promise<void> {
		if (m.noteExistedBefore) {
			await this.applyFieldValue(m.q, m.r, m.field, m.prevValue);
			return;
		}

		const key = hexKey(m.q, m.r);
		const existing = this.hexNotes.get(key);
		if (!existing) return;
		const hasOtherField = (Object.keys(FIELD_ACCESSORS) as HexNoteField[]).some(
			(field) =>
				field !== m.field && FIELD_ACCESSORS[field](existing) !== undefined,
		);
		if (hasOtherField) {
			await this.applyFieldValue(m.q, m.r, m.field, undefined);
			return;
		}

		await this.app.fileManager.trashFile(existing.file);
		this.hexNotes.delete(key);
		this.terrainLayer.updateHex(m.q, m.r, undefined);
		this.iconsLayer.updateHex(m.q, m.r, undefined);
		this.gmIconsLayer.updateHex(m.q, m.r, undefined);
	}

	private makeFieldAction(mutations: FieldMutation[]): UndoableAction {
		return {
			undo: async () => {
				for (let i = mutations.length - 1; i >= 0; i--)
					await this.revertFieldMutation(mutations[i]);
			},
			redo: async () => {
				for (const m of mutations)
					await this.applyFieldValue(m.q, m.r, m.field, m.newValue);
			},
		};
	}
}
