import { App, normalizePath, setIcon, TFile, TFolder } from "obsidian";
import type {
	BorderData,
	HexCoord,
	HexcrawlBlockParams,
	Palette,
} from "../types";
import { loadBorders, reportBorderError } from "../dataLoaders";
import { uniqueFileName } from "../naming";
import { edgeGeometry, validateBorderPairs } from "./borderGeometry";
import { hexCenter, hexNeighbors } from "./hexGeometry";
import { BorderLayer } from "./BorderLayer";
import { applyPathPreviewStyle } from "./pathStyle";
import { createDrawerItem, renderDrawerEmpty } from "./Toolbar";
import type { UndoManager } from "./UndoManager";

/** Simpler than PathToolState: a border's minimum unit is a whole edge, and once ≥1 pair
 *  exists, adding/removing at either end is homogeneous — no separate drawing-vs-editing
 *  behavior is needed the way Path needs it. "picking-first" only exists to bootstrap the very
 *  first edge — one click near the shared edge between two hexes creates it (see
 *  BorderTool.handleClick), after which the note is created and editing takes over. */
export type BorderToolState =
	| { mode: "idle" }
	| { mode: "picking-first"; type: string | undefined }
	| { mode: "editing"; border: BorderData; confirmDelete: boolean };

function renderBorderTypeItem(
	scrollEl: HTMLElement,
	name: string,
	style: Palette["borders"][string],
	onSelect: () => void,
): void {
	const { previewEl } = createDrawerItem(scrollEl, name, onSelect);
	const lineEl = previewEl.createDiv({ cls: "hexcrawl-drawer-path-line" });
	applyPathPreviewStyle(lineEl, style);
}

/** Owns the borders list and the Border tool's own drawer/click state machine; delegates SVG
 *  rendering to its own BorderLayer. */
export class BorderTool {
	private layer: BorderLayer;
	private bordersFolder: TFolder | null = null;
	private bordersList: BorderData[] = [];
	private state: BorderToolState = { mode: "idle" };

	constructor(
		private app: App,
		private params: HexcrawlBlockParams,
		private refreshDrawer: () => void,
		private undoManager: UndoManager,
	) {
		this.layer = new BorderLayer(params);
	}

	load(folder: TFolder | null): void {
		this.bordersFolder = folder;
		this.bordersList = folder
			? loadBorders(
					this.app,
					folder,
					this.params.orientation,
					this.params.stagger,
					{ cols: this.params.cols, rows: this.params.rows },
				)
			: [];
	}

	mount(
		viewportEl: HTMLElement,
		gutter: number,
		totalSize: { width: number; height: number },
	): void {
		this.layer.mount(viewportEl, gutter, totalSize);
		this.render();
	}

	/** Must be called after every other layer has mounted — see BorderLayer.mountOverlay. */
	mountOverlay(
		viewportEl: HTMLElement,
		totalSize: { width: number; height: number },
	): void {
		this.layer.mountOverlay(viewportEl, totalSize);
		this.render();
	}

	setVisible(visible: boolean): void {
		this.layer.setVisible(visible);
	}

	get isVisible(): boolean {
		return this.layer.isVisible;
	}

	/** Abandons whatever the Border tool is doing and returns to idle. Unlike Path, no note is
	 *  ever left half-created — the first edge's note is only written once both its hexes are
	 *  picked — so this never needs to fold anything into the borders list or push undo. */
	reset(): void {
		const hadState = this.state.mode !== "idle";
		this.state = { mode: "idle" };
		if (hadState) this.render();
	}

	render(): void {
		this.layer.render(
			this.bordersList,
			this.state,
			(border, which, pair) => void this.addEdge(border, which, pair),
			(border, which) => void this.removeEnd(border, which),
		);
	}

	/** `point` is the click's viewport (client) coordinates — needed only for "picking-first",
	 *  to tell which of the clicked hex's edges the click landed closest to. */
	handleClick(hit: Element, point: { x: number; y: number }): void {
		const state = this.state;

		// Clicking a different border's line always (re)selects it for editing, from idle or
		// from editing another border — mirrors PathTool.handleClick exactly.
		const borderHit = hit.closest(".hexcrawl-border-hitarea");
		const hitNotePath = borderHit?.getAttribute("data-note-path") ?? undefined;
		if (
			hitNotePath &&
			(state.mode === "idle" ||
				(state.mode === "editing" && hitNotePath !== state.border.file.path))
		) {
			const found = this.bordersList.find((b) => b.file.path === hitNotePath);
			if (found) {
				this.state = { mode: "editing", border: found, confirmDelete: false };
				this.render();
				this.refreshDrawer();
				return;
			}
		}

		if (state.mode === "picking-first") {
			const hexEl = hit.closest(".hexcrawl-hex");
			if (!(hexEl instanceof HTMLElement)) return;
			const q = Number(hexEl.getAttribute("data-q"));
			const r = Number(hexEl.getAttribute("data-r"));
			if (!Number.isInteger(q) || !Number.isInteger(r)) return;
			const pivot: HexCoord = { q, r };

			const other = this.closestEdgeNeighbor(pivot, hexEl, point);
			if (!other) return;
			void this.createBorder(state.type, [pivot, other]);
		}
	}

	/**
	 * Of `pivot`'s up-to-6 neighbors, the one whose shared edge's midpoint is angularly closest
	 * to the click point — i.e. whichever edge the user clicked nearest to. Comparing angles
	 * (rather than pixel distances) means this works regardless of current pan/zoom: a uniform
	 * CSS scale/translate preserves angles measured from a common center, so the angle from
	 * `hexEl`'s on-screen center to the raw click point equals the angle computed from the
	 * hex's un-transformed model-space center.
	 */
	private closestEdgeNeighbor(
		pivot: HexCoord,
		hexEl: HTMLElement,
		point: { x: number; y: number },
	): HexCoord | null {
		const rect = hexEl.getBoundingClientRect();
		const clickAngle = Math.atan2(
			point.y - (rect.top + rect.height / 2),
			point.x - (rect.left + rect.width / 2),
		);

		const { orientation, hexSize: radius, stagger } = this.params;
		const pivotCenter = hexCenter(
			pivot.q,
			pivot.r,
			orientation,
			radius,
			stagger,
		);

		let best: HexCoord | null = null;
		let bestDiff = Infinity;
		for (const n of hexNeighbors(pivot.q, pivot.r, orientation, stagger)) {
			const edge = edgeGeometry(pivot, n, orientation, radius, stagger);
			if (!edge) continue;
			const edgeAngle = Math.atan2(
				(edge.start.cy + edge.end.cy) / 2 - pivotCenter.cy,
				(edge.start.cx + edge.end.cx) / 2 - pivotCenter.cx,
			);
			let diff = Math.abs(clickAngle - edgeAngle);
			if (diff > Math.PI) diff = 2 * Math.PI - diff;
			if (diff < bestDiff) {
				bestDiff = diff;
				best = n;
			}
		}
		return best;
	}

	populateDrawer(scrollEl: HTMLElement): void {
		const state = this.state;

		if (state.mode === "idle") {
			if (!this.bordersFolder) {
				renderDrawerEmpty(scrollEl, "No borders folder configured");
				return;
			}
			const borderStyles = this.params.palette?.borders ?? {};
			for (const name of Object.keys(borderStyles).sort()) {
				renderBorderTypeItem(scrollEl, name, borderStyles[name], () =>
					this.startPicking(name),
				);
			}
			renderDrawerEmpty(scrollEl, "Click existing border to edit it...");
			return;
		}

		if (state.mode === "picking-first") {
			renderDrawerEmpty(
				scrollEl,
				"Click near the shared edge between two hexes to start…",
			);
			return;
		}

		// editing
		if (state.confirmDelete) {
			const { previewEl: keepPreview } = createDrawerItem(
				scrollEl,
				"Keep",
				() => {
					state.confirmDelete = false;
					this.refreshDrawer();
				},
			);
			setIcon(keepPreview, "x");
			const { previewEl: confirmPreview } = createDrawerItem(
				scrollEl,
				"Confirm Delete",
				() => {
					void this.deleteBorder(state.border);
				},
			);
			setIcon(confirmPreview, "trash-2");
			confirmPreview.addClass("is-danger");
			return;
		}

		const { previewEl: delPreview } = createDrawerItem(
			scrollEl,
			"Delete Border",
			() => {
				state.confirmDelete = true;
				this.refreshDrawer();
			},
		);
		setIcon(delPreview, "trash-2");

		renderDrawerEmpty(
			scrollEl,
			"Click a dot to extend, RMB an end edge to remove",
		);
	}

	private startPicking(type: string | undefined): void {
		this.state = { mode: "picking-first", type };
		this.render();
		this.refreshDrawer();
	}

	private nextDefaultBorderName(): string {
		const existing = new Set(this.bordersList.map((b) => b.name));
		let n = this.bordersList.length + 1;
		while (existing.has(`Border ${n}`)) n++;
		return `Border ${n}`;
	}

	private buildBorderFrontmatter(
		type: string | undefined,
		pairs: [HexCoord, HexCoord][],
	): string {
		const lines = ["---"];
		if (type) lines.push(`border-type: ${JSON.stringify(type)}`);
		lines.push("border-hexes:");
		for (const [a, b] of pairs)
			lines.push(`  - [[${a.q}, ${a.r}], [${b.q}, ${b.r}]]`);
		lines.push("---", "");
		return lines.join("\n");
	}

	private async createBorder(
		type: string | undefined,
		pair: [HexCoord, HexCoord],
	): Promise<void> {
		if (!this.bordersFolder) return;
		const validation = validateBorderPairs(
			[pair],
			this.params.orientation,
			this.params.stagger,
			{ cols: this.params.cols, rows: this.params.rows },
		);
		if (!validation.ok) {
			reportBorderError("new border", validation.error);
			this.state = { mode: "picking-first", type };
			this.render();
			this.refreshDrawer();
			return;
		}

		const fileName = uniqueFileName(
			this.nextDefaultBorderName(),
			(candidate) =>
				!!this.app.vault.getAbstractFileByPath(
					normalizePath(`${this.bordersFolder!.path}/${candidate}.md`),
				),
		);
		const path = normalizePath(`${this.bordersFolder.path}/${fileName}.md`);
		const file = await this.app.vault.create(
			path,
			this.buildBorderFrontmatter(type, [pair]),
		);
		const border: BorderData = {
			file,
			name: file.basename,
			type,
			pairs: [pair],
		};
		this.bordersList.push(border);
		this.undoManager.push({
			undo: async () => {
				await this.app.fileManager.trashFile(border.file);
				this.bordersList = this.bordersList.filter((b) => b !== border);
				this.render();
				this.refreshDrawer();
			},
			redo: async () => {
				if (!this.bordersFolder) return;
				border.file = await this.app.vault.create(
					path,
					this.buildBorderFrontmatter(border.type, border.pairs),
				);
				this.bordersList.push(border);
				this.render();
				this.refreshDrawer();
			},
		});
		this.state = { mode: "editing", border, confirmDelete: false };
		this.render();
		this.refreshDrawer();
	}

	private async deleteBorder(border: BorderData): Promise<void> {
		const originalPath = border.file.path;
		await this.app.fileManager.trashFile(border.file);
		this.bordersList = this.bordersList.filter((b) => b !== border);
		this.undoManager.push({
			undo: async () => {
				if (!this.bordersFolder) return;
				border.file = await this.app.vault.create(
					originalPath,
					this.buildBorderFrontmatter(border.type, border.pairs),
				);
				this.bordersList.push(border);
				this.render();
				this.refreshDrawer();
			},
			redo: async () => {
				await this.app.fileManager.trashFile(border.file);
				this.bordersList = this.bordersList.filter((b) => b !== border);
				this.render();
				this.refreshDrawer();
			},
		});
		if (this.state.mode === "editing" && this.state.border === border) {
			this.state = { mode: "idle" };
		}
		this.render();
		this.refreshDrawer();
	}

	/** Registers one undo step for a pairs-array change already applied+saved to `border`. */
	private pushPairsUndo(
		border: BorderData,
		prevPairs: [HexCoord, HexCoord][],
	): void {
		const newPairs = [...border.pairs];
		this.undoManager.push({
			undo: async () => {
				border.pairs = prevPairs;
				await this.saveBorderPairs(border);
				this.render();
			},
			redo: async () => {
				border.pairs = newPairs;
				await this.saveBorderPairs(border);
				this.render();
			},
		});
	}

	private async addEdge(
		border: BorderData,
		which: "prepend" | "append",
		pair: [HexCoord, HexCoord],
	): Promise<void> {
		const prevPairs = [...border.pairs];
		const newPairs: [HexCoord, HexCoord][] =
			which === "prepend" ? [pair, ...border.pairs] : [...border.pairs, pair];
		const validation = validateBorderPairs(
			newPairs,
			this.params.orientation,
			this.params.stagger,
			{ cols: this.params.cols, rows: this.params.rows },
		);
		if (!validation.ok) {
			reportBorderError(border.name, validation.error);
			return;
		}
		border.pairs = newPairs;
		await this.saveBorderPairs(border);
		this.pushPairsUndo(border, prevPairs);
		this.render();
	}

	private async removeEnd(
		border: BorderData,
		which: "first" | "last",
	): Promise<void> {
		if (border.pairs.length <= 1) {
			await this.deleteBorder(border);
			return;
		}
		const prevPairs = [...border.pairs];
		border.pairs =
			which === "first" ? border.pairs.slice(1) : border.pairs.slice(0, -1);
		await this.saveBorderPairs(border);
		this.pushPairsUndo(border, prevPairs);
		this.render();
	}

	private async saveBorderPairs(border: BorderData): Promise<void> {
		await this.writeBorderPairs(border.file, border.pairs);
	}

	/** Live TFile for the border whose note currently lives at `notePath` — used by the generic
	 *  (no active tool) click-to-open handler. */
	findFile(notePath: string): TFile | undefined {
		return this.bordersList.find((b) => b.file.path === notePath)?.file;
	}

	private async writeBorderPairs(
		file: TFile,
		pairs: [HexCoord, HexCoord][],
	): Promise<void> {
		await this.app.fileManager.processFrontMatter(
			file,
			(fm: Record<string, unknown>) => {
				fm["border-hexes"] = pairs.map(([a, b]) => [
					[a.q, a.r],
					[b.q, b.r],
				]);
			},
		);
	}
}
