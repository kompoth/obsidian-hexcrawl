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

/** Sub-mode when editing an existing path's points. */
export type EditSub = "move" | "add" | "remove";

/** Nested state machine for the Path tool — everything else is single-click paint/fill. */
export type PathToolState =
	| { mode: "idle" }
	| {
			mode: "drawing";
			type: string | undefined;
			hexes: HexCoord[];
			prependNext: boolean;
	  }
	| {
			mode: "editing";
			path: PathData;
			sub: EditSub;
			insertAt: number | null;
			addAtStart: boolean;
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

	/** Abandons whatever the Path tool is doing (drawing/editing) and returns to idle. */
	reset(): void {
		const hadState = this.state.mode !== "idle";
		this.state = { mode: "idle" };
		if (hadState) this.render();
	}

	render(): void {
		this.layer.render(
			this.pathsList,
			this.state,
			(path, index, q, r) => void this.movePathPoint(path, index, q, r),
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
					sub: "move",
					insertAt: null,
					addAtStart: false,
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
			this.render();
			this.refreshDrawer();
			return;
		}

		if (state.mode === "editing" && state.sub === "remove") {
			const marker = hit.closest(".hexcrawl-path-marker");
			const idx = marker ? Number(marker.getAttribute("data-index")) : NaN;
			if (Number.isInteger(idx)) void this.removePathPoint(state, idx);
			return;
		}

		if (state.mode === "editing" && state.sub === "add") {
			const addMarker = hit.closest(".hexcrawl-path-marker-add");
			if (addMarker) {
				state.insertAt = Number(addMarker.getAttribute("data-insert-at"));
				return;
			}
			const hexEl = hit.closest(".hexcrawl-hex");
			if (!(hexEl instanceof HTMLElement)) return;
			const q = Number(hexEl.getAttribute("data-q"));
			const r = Number(hexEl.getAttribute("data-r"));
			if (!Number.isInteger(q) || !Number.isInteger(r)) return;
			void this.insertPathPoint(state, q, r);
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
			const { previewEl: cancelPreview } = createDrawerItem(
				scrollEl,
				"Cancel",
				() => this.cancelPathTool(),
			);
			setIcon(cancelPreview, "x");
			const { previewEl: dirPreview } = createDrawerItem(
				scrollEl,
				state.prependNext ? "Add at Start" : "Add at End",
				() => {
					state.prependNext = !state.prependNext;
					this.refreshDrawer();
				},
			);
			setIcon(dirPreview, state.prependNext ? "arrow-left" : "arrow-right");
			if (state.hexes.length >= 2) {
				const { previewEl: finishPreview } = createDrawerItem(
					scrollEl,
					"Finish",
					() => {
						void this.createPathFromDrawing(state.type, state.hexes);
					},
				);
				setIcon(finishPreview, "check");
			} else {
				renderDrawerEmpty(scrollEl, "Click hexes to add points…");
			}
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

		const subs: { kind: EditSub; icon: string; label: string }[] = [
			{ kind: "move", icon: "move", label: "Move" },
			{ kind: "add", icon: "circle-plus", label: "Add" },
			{ kind: "remove", icon: "circle-minus", label: "Remove" },
		];
		for (const sub of subs) {
			const { itemEl, previewEl } = createDrawerItem(
				scrollEl,
				sub.label,
				() => {
					state.sub = sub.kind;
					state.insertAt = null;
					state.addAtStart = false;
					this.render();
					this.refreshDrawer();
				},
			);
			setIcon(previewEl, sub.icon);
			if (state.sub === sub.kind) itemEl.addClass("is-selected");
		}
		if (state.sub === "add") {
			const { previewEl: dirPreview } = createDrawerItem(
				scrollEl,
				state.addAtStart ? "Add at Start" : "Add at End",
				() => {
					state.addAtStart = !state.addAtStart;
					this.refreshDrawer();
				},
			);
			setIcon(dirPreview, state.addAtStart ? "arrow-left" : "arrow-right");
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
	}

	private startDrawingPath(type: string | undefined): void {
		this.state = { mode: "drawing", type, hexes: [], prependNext: false };
		this.render();
		this.refreshDrawer();
	}

	/** Abandons the in-progress new path and returns to idle. */
	private cancelPathTool(): void {
		this.state = { mode: "idle" };
		this.render();
		this.refreshDrawer();
	}

	private nextDefaultPathName(): string {
		const existing = new Set(this.pathsList.map((p) => p.name));
		let n = this.pathsList.length + 1;
		while (existing.has(`Path ${n}`)) n++;
		return `Path ${n}`;
	}

	/** Creates the note for a finished new path, named from the default template — rename the note itself to change it. */
	private async createPathFromDrawing(
		type: string | undefined,
		hexes: HexCoord[],
	): Promise<void> {
		if (!this.pathsFolder) return;
		const folder = this.pathsFolder;
		const fileName = uniqueFileName(
			this.nextDefaultPathName(),
			(candidate) =>
				!!this.app.vault.getAbstractFileByPath(
					normalizePath(`${folder.path}/${candidate}.md`),
				),
		);
		const path = normalizePath(`${folder.path}/${fileName}.md`);

		const lines = ["---"];
		if (type) lines.push(`path-type: ${JSON.stringify(type)}`);
		lines.push("path-hexes:");
		for (const h of hexes) lines.push(`  - [${h.q}, ${h.r}]`);
		lines.push("---", "");

		const file = await this.app.vault.create(path, lines.join("\n"));
		this.pathsList.push({
			notePath: file.path,
			name: file.basename,
			type,
			hexes: [...hexes],
		});
		this.state = { mode: "idle" };
		this.render();
		this.refreshDrawer();
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
		state: Extract<PathToolState, { mode: "editing" }>,
		q: number,
		r: number,
	): Promise<void> {
		const at =
			state.insertAt ?? (state.addAtStart ? 0 : state.path.hexes.length);
		state.path.hexes.splice(at, 0, { q, r });
		state.insertAt = null;
		await this.savePathHexes(state.path);
		this.render();
	}

	private async removePathPoint(
		state: Extract<PathToolState, { mode: "editing" }>,
		index: number,
	): Promise<void> {
		if (state.path.hexes.length <= 2) {
			new Notice(
				"A path needs at least 2 points — use Delete Path to remove it entirely.",
			);
			return;
		}
		state.path.hexes.splice(index, 1);
		await this.savePathHexes(state.path);
		this.render();
	}

	private async savePathHexes(path: PathData): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path.notePath);
		if (!(file instanceof TFile)) return;
		await this.app.fileManager.processFrontMatter(
			file,
			(fm: Record<string, unknown>) => {
				fm["path-hexes"] = path.hexes.map((h) => [h.q, h.r]);
			},
		);
	}
}
