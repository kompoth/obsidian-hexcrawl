import {
	App,
	MarkdownPostProcessorContext,
	normalizePath,
	TFile,
	TFolder,
} from "obsidian";
import type { HexCoord, HexcrawlBlockParams, HexNoteData } from "./types";
import {
	gridBoundingBox,
	hexCenter,
	hexKey,
	hexNeighbors,
} from "./hexGeometry";
import { loadHexNotes } from "./dataLoaders";
import { resolveIconsFolder } from "./pure";
import { setupPanAndZoom } from "./PanZoom";
import { createDrawerToggleItem, Toolbar } from "./Toolbar";
import type { DrawerSelection, ToolKind } from "./Toolbar";
import { PathTool } from "./PathTool";
import { TerrainLayer } from "./TerrainLayer";
import { IconsLayer } from "./IconsLayer";

const MIN_GUTTER = 20;

export class HexMapRenderer {
	private folder: TFolder | null = null;
	private hexNotes = new Map<string, HexNoteData>();

	private toolbar: Toolbar;
	private pathTool: PathTool;
	private terrainLayer: TerrainLayer;
	private iconsLayer: IconsLayer;

	constructor(
		private app: App,
		private container: HTMLElement,
		private params: HexcrawlBlockParams,
		private ctx: MarkdownPostProcessorContext,
	) {
		this.toolbar = new Toolbar(app, params, {
			onToolChange: () => this.pathTool.reset(),
			populatePathDrawer: (scrollEl) => this.pathTool.populateDrawer(scrollEl),
			populateLayersDrawer: (scrollEl) => this.populateLayersDrawer(scrollEl),
		});
		this.pathTool = new PathTool(app, params, () =>
			this.toolbar.refreshDrawer(),
		);
		this.terrainLayer = new TerrainLayer(params);
		this.iconsLayer = new IconsLayer(app, params);
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
		} = this.params;
		const pathsFolderObj = pathsFolder
			? this.app.vault.getAbstractFileByPath(normalizePath(pathsFolder))
			: undefined;
		this.pathTool.load(
			pathsFolderObj instanceof TFolder ? pathsFolderObj : null,
		);

		const clipEl = this.container.createDiv({ cls: "hexcrawl-clip" });
		clipEl.style.height = `${height}px`;
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

		// Stacking order, bottom to top: terrain colors, then paths, then icons — icons
		// render last (and so on top of paths) so a path crossing a hex never paints over
		// its icon.
		this.terrainLayer.mount(viewportEl);
		this.terrainLayer.render(this.hexNotes, gutter);

		this.pathTool.mount(viewportEl, gutter, totalSize);

		this.iconsLayer.mount(viewportEl, totalSize);
		void this.iconsLayer.load(resolveIconsFolder(this.params)).then(() => {
			this.iconsLayer.render(this.hexNotes, gutter);
		});

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
		);
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
		const layers = [this.terrainLayer, this.pathTool, this.iconsLayer] as const;
		const labels = ["Terrain", "Paths", "Icons"] as const;
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
		const notePath = el?.getAttribute("data-note-path");
		if (!notePath) return;
		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (file instanceof TFile) {
			void this.app.workspace.getLeaf(true).openFile(file);
		}
	}

	private async runTool(
		q: number,
		r: number,
		activeTool: Exclude<ToolKind, "path">,
		selection: DrawerSelection | null,
	): Promise<void> {
		if (!selection) return;

		switch (activeTool) {
			case "brush":
				await this.writeHexField(
					q,
					r,
					"hex-terrain",
					selection.erase ? undefined : selection.value,
				);
				break;
			case "icon":
				await this.writeHexField(
					q,
					r,
					"hex-icon",
					selection.erase ? undefined : selection.value,
				);
				break;
			case "bucket":
				if (!selection.erase) await this.bucketFill(q, r, selection.value);
				break;
			case "layers":
				break; // Layers tool has no per-hex click effect.
			default:
				activeTool satisfies never;
		}
	}

	/** Flood-fills the contiguous region of hexes sharing the clicked hex's current hex-terrain. */
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

		await Promise.all(
			region.map((cell) =>
				this.writeHexField(cell.q, cell.r, "hex-terrain", value),
			),
		);
	}

	/**
	 * Sets or clears one frontmatter field on the hex note at (q, r) — updating the existing
	 * note via processFrontMatter, or creating a new "_r{r}_q{q}.md" note if the hex was
	 * previously unconfigured (clearing an already-empty hex is a no-op: nothing to create).
	 * Patches the live DOM in place afterward rather than re-rendering the whole map, so pan/
	 * zoom/tool state survives.
	 */
	private async writeHexField(
		q: number,
		r: number,
		field: "hex-terrain" | "hex-icon",
		value: string | undefined,
	): Promise<void> {
		const key = hexKey(q, r);
		const existing = this.hexNotes.get(key);
		const patch = (base: { terrain?: string; icon?: string }) => ({
			terrain: field === "hex-terrain" ? value : base.terrain,
			icon: field === "hex-icon" ? value : base.icon,
		});

		if (existing) {
			const file = this.app.vault.getAbstractFileByPath(existing.path);
			if (!(file instanceof TFile)) return;
			await this.app.fileManager.processFrontMatter(
				file,
				(fm: Record<string, unknown>) => {
					if (value === undefined) delete fm[field];
					else fm[field] = value;
				},
			);
			const updated: HexNoteData = { ...existing, ...patch(existing) };
			this.hexNotes.set(key, updated);
			this.terrainLayer.updateHex(q, r, updated);
			this.iconsLayer.updateHex(q, r, updated);
			return;
		}

		if (value === undefined || !this.folder) return;

		const path = normalizePath(`${this.folder.path}/_r${r}_q${q}.md`);
		const content = `---\nhex-q: ${q}\nhex-r: ${r}\n${field}: ${JSON.stringify(value)}\n---\n`;
		const file = await this.app.vault.create(path, content);
		const created: HexNoteData = {
			path: file.path,
			name: file.basename,
			...patch({}),
		};
		this.hexNotes.set(key, created);
		this.terrainLayer.updateHex(q, r, created);
		this.iconsLayer.updateHex(q, r, created);
	}
}
