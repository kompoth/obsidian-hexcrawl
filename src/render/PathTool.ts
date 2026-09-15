import { App, normalizePath, Notice, setIcon, TFile, TFolder } from "obsidian";
import type {
	HexCoord,
	HexcrawlBlockParams,
	Palette,
	PathData,
} from "../types";
import { loadPaths } from "../dataLoaders";
import { uniqueFileName } from "../naming";
import { PathLayer } from "./PathLayer";
import { applyPathPreviewStyle } from "./pathStyle";
import { createDrawerItem, renderDrawerEmpty } from "./Toolbar";

/** Nested state machine for the Path tool — everything else is single-click paint/fill.
 *  Editing has no sub-modes: moving a point (drag), inserting one mid-path (drag a
 *  midpoint), and removing one (right-click) are all live simultaneously; pendingEnd
 *  arms the next hex click to append/prepend a point instead. */
export type PathToolState =
	| { mode: "idle" }
	| {
			mode: "drawing";
			type: string | undefined;
			hexes: HexCoord[];
			prependNext: boolean;
			/** Set once the path has >= 2 points and its note has been created — every point
			 *  added after that is written straight to this file, so the drawing preview is
			 *  never out of sync with the note on disk. */
			file: TFile | null;
	  }
	| {
			mode: "editing";
			path: PathData;
			pendingEnd: "start" | "end" | null;
			confirmDelete: boolean;
	  };

function renderPathTypeItem(
	scrollEl: HTMLElement,
	name: string,
	style: Palette["paths"][string],
	onSelect: () => void,
): void {
	const { previewEl } = createDrawerItem(scrollEl, name, onSelect);
	const lineEl = previewEl.createDiv({ cls: "hexcrawl-drawer-path-line" });
	applyPathPreviewStyle(lineEl, style);
}

/** Owns the paths list and the Path tool's own drawer/click state machine; delegates SVG
 *  rendering to its own PathLayer. */
export class PathTool {
	private layer: PathLayer;
	private pathsFolder: TFolder | null = null;
	private pathsList: PathData[] = [];
	private state: PathToolState = { mode: "idle" };
	/** In-flight file-creation for the current drawing session, so two points added in quick
	 *  succession (before the first vault.create() resolves) don't both try to create the file. */
	private drawingFilePromise: Promise<TFile> | null = null;

	constructor(
		private app: App,
		private params: HexcrawlBlockParams,
		private refreshDrawer: () => void,
	) {
		this.layer = new PathLayer(params);
	}

	load(folder: TFolder | null): void {
		this.pathsFolder = folder;
		this.pathsList = folder ? loadPaths(this.app, folder) : [];
	}

	mount(
		viewportEl: HTMLElement,
		gutter: number,
		totalSize: { width: number; height: number },
	): void {
		this.layer.mount(viewportEl, gutter, totalSize);
		this.render();
	}

	setVisible(visible: boolean): void {
		this.layer.setVisible(visible);
	}

	get isVisible(): boolean {
		return this.layer.isVisible;
	}

	/**
	 * Abandons whatever the Path tool is doing and returns to idle. A path being drawn is
	 * already saved to disk once it has 2+ points (nothing to undo), so this just needs to
	 * fold it into the in-memory paths list — otherwise it would keep rendering as the
	 * "in progress" preview instead of a normal path until the block is fully re-rendered.
	 */
	reset(): void {
		const state = this.state;
		if (state.mode === "drawing" && state.file) {
			this.pathsList.push({
				notePath: state.file.path,
				name: state.file.basename,
				type: state.type,
				hexes: [...state.hexes],
			});
		}
		this.drawingFilePromise = null;
		const hadState = state.mode !== "idle";
		this.state = { mode: "idle" };
		if (hadState) this.render();
	}

	render(): void {
		this.layer.render(
			this.pathsList,
			this.state,
			(path, index, q, r) => void this.movePathPoint(path, index, q, r),
			(path, insertAt, q, r) => void this.insertPathPoint(path, insertAt, q, r),
			(path, index) => void this.removePathPoint(path, index),
		);
	}

	handleClick(hit: Element): void {
		const state = this.state;

		// Clicking a different path's line always (re)selects it for editing,
		// regardless of whether we were idle or already editing another one.
		const pathHit = hit.closest(".hexcrawl-path-hitarea");
		const hitNotePath = pathHit?.getAttribute("data-note-path") ?? undefined;
		if (
			hitNotePath &&
			(state.mode === "idle" ||
				(state.mode === "editing" && hitNotePath !== state.path.notePath))
		) {
			const found = this.pathsList.find((p) => p.notePath === hitNotePath);
			if (found) {
				this.state = {
					mode: "editing",
					path: found,
					pendingEnd: null,
					confirmDelete: false,
				};
				this.render();
				this.refreshDrawer();
				return;
			}
		}

		if (state.mode === "drawing") {
			const hexEl = hit.closest(".hexcrawl-hex");
			if (!(hexEl instanceof HTMLElement)) return;
			const q = Number(hexEl.getAttribute("data-q"));
			const r = Number(hexEl.getAttribute("data-r"));
			if (!Number.isInteger(q) || !Number.isInteger(r)) return;
			const edge = state.prependNext
				? state.hexes[0]
				: state.hexes[state.hexes.length - 1];
			if (edge && edge.q === q && edge.r === r) return;
			if (state.prependNext) state.hexes.unshift({ q, r });
			else state.hexes.push({ q, r });
			void this.persistDrawingPoint(state);
			this.render();
			this.refreshDrawer();
			return;
		}

		if (state.mode === "editing" && state.pendingEnd) {
			const hexEl = hit.closest(".hexcrawl-hex");
			if (!(hexEl instanceof HTMLElement)) return;
			const q = Number(hexEl.getAttribute("data-q"));
			const r = Number(hexEl.getAttribute("data-r"));
			if (!Number.isInteger(q) || !Number.isInteger(r)) return;
			const at = state.pendingEnd === "start" ? 0 : state.path.hexes.length;
			state.pendingEnd = null;
			void this.insertPathPoint(state.path, at, q, r);
			this.refreshDrawer();
		}
	}

	populateDrawer(scrollEl: HTMLElement): void {
		const state = this.state;

		if (state.mode === "idle") {
			if (!this.pathsFolder) {
				renderDrawerEmpty(scrollEl, "No paths folder configured");
				return;
			}
			const pathStyles = this.params.palette?.paths ?? {};
			for (const name of Object.keys(pathStyles).sort()) {
				renderPathTypeItem(scrollEl, name, pathStyles[name], () =>
					this.startDrawingPath(name),
				);
			}
			renderDrawerEmpty(scrollEl, "Click existing path to edit it...");
			return;
		}

		if (state.mode === "drawing") {
			const { previewEl: dirPreview } = createDrawerItem(
				scrollEl,
				state.prependNext ? "Add at Start" : "Add at End",
				() => {
					state.prependNext = !state.prependNext;
					this.refreshDrawer();
				},
			);
			setIcon(dirPreview, state.prependNext ? "arrow-left" : "arrow-right");
			if (state.hexes.length < 2)
				renderDrawerEmpty(scrollEl, "Click hexes to add points…");
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
					void this.deleteSelectedPath(state.path);
				},
			);
			setIcon(confirmPreview, "trash-2");
			confirmPreview.addClass("is-danger");
			return;
		}

		const { previewEl: delPreview } = createDrawerItem(
			scrollEl,
			"Delete Path",
			() => {
				state.confirmDelete = true;
				this.refreshDrawer();
			},
		);
		setIcon(delPreview, "trash-2");

		const { previewEl: startPreview } = createDrawerItem(
			scrollEl,
			"Add to Start",
			() => {
				state.pendingEnd = "start";
			},
		);
		setIcon(startPreview, "arrow-left");

		const { previewEl: endPreview } = createDrawerItem(
			scrollEl,
			"Add to End",
			() => {
				state.pendingEnd = "end";
			},
		);
		setIcon(endPreview, "arrow-right");

		renderDrawerEmpty(scrollEl, "RMB to delete point");
	}

	private startDrawingPath(type: string | undefined): void {
		this.drawingFilePromise = null;
		this.state = {
			mode: "drawing",
			type,
			hexes: [],
			prependNext: false,
			file: null,
		};
		this.render();
		this.refreshDrawer();
	}

	private nextDefaultPathName(): string {
		const existing = new Set(this.pathsList.map((p) => p.name));
		let n = this.pathsList.length + 1;
		while (existing.has(`Path ${n}`)) n++;
		return `Path ${n}`;
	}

	/**
	 * Writes the current drawing state's points to disk — creating the note (named from the
	 * default template; rename the note itself to change it) the first time it has 2+ points,
	 * and just updating path-hexes on every point after that.
	 */
	private async persistDrawingPoint(
		state: Extract<PathToolState, { mode: "drawing" }>,
	): Promise<void> {
		if (state.hexes.length < 2 || !this.pathsFolder) return;
		if (!state.file) {
			if (!this.drawingFilePromise)
				this.drawingFilePromise = this.createDrawingFile(
					this.pathsFolder,
					state,
				);
			// Awaited by every point added while creation is still in flight, so each of
			// them falls through to the write below instead of silently dropping its point.
			state.file = await this.drawingFilePromise;
		}
		await this.writePathHexes(state.file, state.hexes);
	}

	private async createDrawingFile(
		folder: TFolder,
		state: Extract<PathToolState, { mode: "drawing" }>,
	): Promise<TFile> {
		const fileName = uniqueFileName(
			this.nextDefaultPathName(),
			(candidate) =>
				!!this.app.vault.getAbstractFileByPath(
					normalizePath(`${folder.path}/${candidate}.md`),
				),
		);
		const path = normalizePath(`${folder.path}/${fileName}.md`);

		const lines = ["---"];
		if (state.type) lines.push(`path-type: ${JSON.stringify(state.type)}`);
		lines.push("path-hexes:");
		for (const h of state.hexes) lines.push(`  - [${h.q}, ${h.r}]`);
		lines.push("---", "");

		return this.app.vault.create(path, lines.join("\n"));
	}

	private async deleteSelectedPath(path: PathData): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path.notePath);
		if (file instanceof TFile) await this.app.fileManager.trashFile(file);
		this.pathsList = this.pathsList.filter((p) => p !== path);
		this.state = { mode: "idle" };
		this.render();
		this.refreshDrawer();
	}

	private async movePathPoint(
		path: PathData,
		index: number,
		q: number,
		r: number,
	): Promise<void> {
		path.hexes[index] = { q, r };
		await this.savePathHexes(path);
		this.render();
	}

	private async insertPathPoint(
		path: PathData,
		at: number,
		q: number,
		r: number,
	): Promise<void> {
		path.hexes.splice(at, 0, { q, r });
		await this.savePathHexes(path);
		this.render();
	}

	private async removePathPoint(path: PathData, index: number): Promise<void> {
		if (path.hexes.length <= 2) {
			new Notice(
				"A path needs at least 2 points — use Delete Path to remove it entirely.",
			);
			return;
		}
		path.hexes.splice(index, 1);
		await this.savePathHexes(path);
		this.render();
	}

	private async savePathHexes(path: PathData): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path.notePath);
		if (!(file instanceof TFile)) return;
		await this.writePathHexes(file, path.hexes);
	}

	private async writePathHexes(file: TFile, hexes: HexCoord[]): Promise<void> {
		await this.app.fileManager.processFrontMatter(
			file,
			(fm: Record<string, unknown>) => {
				fm["path-hexes"] = hexes.map((h) => [h.q, h.r]);
			},
		);
	}
}
