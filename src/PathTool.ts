import { App, normalizePath, Notice, setIcon, TFile, TFolder } from "obsidian";
import type { HexCoord, HexcrawlBlockParams, Palette, PathData } from "./types";
import { hexCenter, sharpPath, smoothPath } from "./hexGeometry";
import { createDrawerItem, renderDrawerEmpty } from "./Toolbar";
import { dashArray, parsePathFrontmatter, uniqueFileName } from "./pure";

const DEFAULT_PATH_WIDTH = 3;
const MIN_HITAREA_WIDTH = 14;

export function loadPaths(app: App, folder: TFolder): PathData[] {
	const paths: PathData[] = [];
	for (const child of folder.children) {
		if (!(child instanceof TFile) || child.extension !== "md") continue;
		const frontmatter = app.metadataCache.getFileCache(child)?.frontmatter;
		if (!frontmatter) continue;
		const parsed = parsePathFrontmatter(frontmatter);
		if (!parsed) continue;
		paths.push({ notePath: child.path, name: child.basename, ...parsed });
	}
	return paths;
}

/** Sub-mode when editing an existing path's points. */
export type EditSub = "move" | "add" | "remove";

/** Nested state machine for the Path tool — everything else is single-click paint/fill. */
export type PathToolState =
	| { mode: "idle" }
	| { mode: "choosingType" }
	| { mode: "drawing"; type: string | undefined; hexes: HexCoord[]; prependNext: boolean }
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
	lineEl.style.borderTopColor = style.color ?? "var(--text-muted)";
	lineEl.style.borderTopWidth = `${Math.min(Math.max(style.width ?? DEFAULT_PATH_WIDTH, 1), 6)}px`;
	lineEl.style.borderTopStyle = style.dash === "dotted" || style.dash === "dashed" ? style.dash : "solid";
}

/** Owns the paths list, their SVG rendering, and the Path tool's own drawer/click state machine. */
export class PathTool {
	private pathsFolder: TFolder | null = null;
	private pathsList: PathData[] = [];
	private pathsSvg: SVGSVGElement | null = null;
	private gutter = 0;
	private state: PathToolState = { mode: "idle" };
	private visible = true;

	constructor(
		private app: App,
		private params: HexcrawlBlockParams,
		private refreshDrawer: () => void,
	) {}

	load(folder: TFolder | null): void {
		this.pathsFolder = folder;
		this.pathsList = folder ? loadPaths(this.app, folder) : [];
	}

	/** Creates the paths layer's own SVG under viewportEl (always, even with zero paths yet, so the
	 *  Path tool can add the map's first path without a full grid re-render) and does the initial render. */
	mount(viewportEl: HTMLElement, gutter: number, totalSize: { width: number; height: number }): void {
		this.pathsSvg = viewportEl.createSvg("svg", {
			cls: ["hexcrawl-layer", "hexcrawl-paths"],
			attr: { width: totalSize.width, height: totalSize.height },
		});
		this.pathsSvg.style.display = this.visible ? "" : "none";
		this.gutter = gutter;
		this.render();
	}

	setVisible(visible: boolean): void {
		this.visible = visible;
		if (this.pathsSvg) this.pathsSvg.style.display = visible ? "" : "none";
	}

	get isVisible(): boolean {
		return this.visible;
	}

	/** Abandons whatever the Path tool is doing (drawing/editing) and returns to idle. */
	reset(): void {
		const hadState = this.state.mode !== "idle";
		this.state = { mode: "idle" };
		if (hadState) this.render();
	}

	/**
	 * (Re)draws every path plus, if the Path tool is mid-draw or mid-edit, the in-progress
	 * preview line and/or point markers — into the persistent pathsSvg. Called after every
	 * path mutation instead of rebuilding the whole grid, so pan/zoom/tool state survives.
	 */
	render(): void {
		if (!this.pathsSvg) return;
		this.pathsSvg.empty();
		const { orientation, hexSize: radius, palette, stagger } = this.params;
		const gutter = this.gutter;
		const toPt = (h: HexCoord) => {
			const c = hexCenter(h.q, h.r, orientation, radius, stagger);
			return { cx: gutter + c.cx, cy: gutter + c.cy };
		};

		for (const path of this.pathsList) {
			const points = path.hexes.map(toPt);
			const style = path.type ? palette?.paths[path.type] : undefined;
			const spline = path.spline ?? style?.spline ?? false;
			const d = spline ? smoothPath(points) : sharpPath(points);
			const width = style?.width ?? DEFAULT_PATH_WIDTH;

			const pathEl = this.pathsSvg.createSvg("path", {
				cls: path.type ? ["hexcrawl-path", `hexcrawl-path-${path.type}`] : "hexcrawl-path",
				attr: { d, fill: "none", "data-note-path": path.notePath },
			});
			const color = style?.color ?? path.type;
			if (color) pathEl.style.stroke = color;
			if (style?.width) pathEl.style.strokeWidth = String(style.width);
			if (style?.dash) pathEl.style.strokeDasharray = dashArray(style.dash, width);
			if (!path.name.startsWith("_")) pathEl.createSvg("title").textContent = path.name;

			// Wider, invisible sibling so a thin/dashed line is still easy to click/select.
			const hitEl = this.pathsSvg.createSvg("path", {
				cls: "hexcrawl-path-hitarea",
				attr: { d, fill: "none", "data-note-path": path.notePath },
			});
			hitEl.style.strokeWidth = String(Math.max(width, MIN_HITAREA_WIDTH));
		}

		const state = this.state;

		if (state.mode === "drawing") {
			const points = state.hexes.map(toPt);
			if (points.length >= 2) {
				const style = state.type ? palette?.paths[state.type] : undefined;
				const width = style?.width ?? DEFAULT_PATH_WIDTH;
				const d = style?.spline ? smoothPath(points) : sharpPath(points);
				const previewEl = this.pathsSvg.createSvg("path", {
					cls: "hexcrawl-path-preview",
					attr: { d, fill: "none" },
				});
				if (style?.color) previewEl.style.stroke = style.color;
				if (style?.width) previewEl.style.strokeWidth = String(style.width);
				previewEl.style.strokeDasharray = style?.dash ? dashArray(style.dash, width) : "none";
			}
			for (const p of points) {
				this.pathsSvg.createSvg("circle", {
					cls: "hexcrawl-path-marker",
					attr: { cx: String(p.cx), cy: String(p.cy), r: "5" },
				});
			}
		}

		if (state.mode === "editing") {
			const points = state.path.hexes.map(toPt);
			points.forEach((p, i) => {
				const marker = this.pathsSvg!.createSvg("circle", {
					cls: "hexcrawl-path-marker",
					attr: { cx: String(p.cx), cy: String(p.cy), r: "6", "data-index": String(i) },
				});
				if (state.sub === "move") this.attachMarkerDrag(marker, state.path, i);
			});
			if (state.sub === "add") {
				for (let i = 0; i < points.length - 1; i++) {
					const mx = (points[i].cx + points[i + 1].cx) / 2;
					const my = (points[i].cy + points[i + 1].cy) / 2;
					this.pathsSvg.createSvg("circle", {
						cls: "hexcrawl-path-marker-add",
						attr: { cx: String(mx), cy: String(my), r: "4", "data-insert-at": String(i + 1) },
					});
				}
				// Extrapolated markers just beyond each end, for prepending/appending a point.
				if (points.length >= 2) {
					const first = points[0];
					const second = points[1];
					this.pathsSvg.createSvg("circle", {
						cls: "hexcrawl-path-marker-add",
						attr: {
							cx: String(first.cx + (first.cx - second.cx) * 0.5),
							cy: String(first.cy + (first.cy - second.cy) * 0.5),
							r: "4",
							"data-insert-at": "0",
						},
					});
					const last = points[points.length - 1];
					const secondLast = points[points.length - 2];
					this.pathsSvg.createSvg("circle", {
						cls: "hexcrawl-path-marker-add",
						attr: {
							cx: String(last.cx + (last.cx - secondLast.cx) * 0.5),
							cy: String(last.cy + (last.cy - secondLast.cy) * 0.5),
							r: "4",
							"data-insert-at": String(points.length),
						},
					});
				}
			}
		}
	}

	/** Drag-to-move for a single path point marker; snaps to whichever hex the pointer is over on release. */
	private attachMarkerDrag(markerEl: SVGCircleElement, path: PathData, index: number): void {
		markerEl.addEventListener("pointerdown", (e: PointerEvent) => {
			e.stopPropagation();
			e.preventDefault();
			markerEl.setPointerCapture(e.pointerId);
			let hoverHex: HTMLElement | null = null;

			const highlight = (ev: PointerEvent) => {
				const el = document.elementFromPoint(ev.clientX, ev.clientY);
				const hexEl = el?.closest(".hexcrawl-hex");
				const next = hexEl instanceof HTMLElement ? hexEl : null;
				if (next !== hoverHex) {
					hoverHex?.removeClass("hexcrawl-hex-drop-target");
					hoverHex = next;
					hoverHex?.addClass("hexcrawl-hex-drop-target");
				}
				return hoverHex;
			};

			const onMove = (ev: PointerEvent) => highlight(ev);
			const onUp = (ev: PointerEvent) => {
				markerEl.removeEventListener("pointermove", onMove);
				markerEl.removeEventListener("pointerup", onUp);
				const hexEl = highlight(ev);
				hexEl?.removeClass("hexcrawl-hex-drop-target");
				if (hexEl) {
					const q = Number(hexEl.getAttribute("data-q"));
					const r = Number(hexEl.getAttribute("data-r"));
					if (Number.isInteger(q) && Number.isInteger(r)) void this.movePathPoint(path, index, q, r);
				}
			};
			markerEl.addEventListener("pointermove", onMove);
			markerEl.addEventListener("pointerup", onUp);
		});
	}

	handleClick(hit: Element): void {
		const state = this.state;

		// Clicking a different path's line always (re)selects it for editing,
		// regardless of whether we were idle or already editing another one.
		const pathHit = hit.closest(".hexcrawl-path-hitarea");
		const hitNotePath = pathHit?.getAttribute("data-note-path") ?? undefined;
		if (hitNotePath && (state.mode === "idle" || (state.mode === "editing" && hitNotePath !== state.path.notePath))) {
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
			const edge = state.prependNext ? state.hexes[0] : state.hexes[state.hexes.length - 1];
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
			const { previewEl } = createDrawerItem(scrollEl, "New Path", () => {
				this.state = { mode: "choosingType" };
				this.refreshDrawer();
			});
			setIcon(previewEl, "plus");
			renderDrawerEmpty(scrollEl, "Click existing path to edit it...");
			return;
		}

		if (state.mode === "choosingType") {
			const pathStyles = this.params.palette?.paths ?? {};
			for (const name of Object.keys(pathStyles).sort()) {
				renderPathTypeItem(scrollEl, name, pathStyles[name], () => this.startDrawingPath(name));
			}
			return;
		}

		if (state.mode === "drawing") {
			const { previewEl: cancelPreview } = createDrawerItem(scrollEl, "Cancel", () => this.cancelPathTool());
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
				const { previewEl: finishPreview } = createDrawerItem(scrollEl, "Finish", () => {
					void this.createPathFromDrawing(state.type, state.hexes);
				});
				setIcon(finishPreview, "check");
			} else {
				renderDrawerEmpty(scrollEl, "Click hexes to add points…");
			}
			return;
		}

		// editing
		if (state.confirmDelete) {
			const { previewEl: keepPreview } = createDrawerItem(scrollEl, "Keep", () => {
				state.confirmDelete = false;
				this.refreshDrawer();
			});
			setIcon(keepPreview, "x");
			const { previewEl: confirmPreview } = createDrawerItem(scrollEl, "Confirm Delete", () => {
				void this.deleteSelectedPath(state.path);
			});
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
			const { itemEl, previewEl } = createDrawerItem(scrollEl, sub.label, () => {
				state.sub = sub.kind;
				state.insertAt = null;
				state.addAtStart = false;
				this.render();
				this.refreshDrawer();
			});
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
		const { previewEl: delPreview } = createDrawerItem(scrollEl, "Delete Path", () => {
			state.confirmDelete = true;
			this.refreshDrawer();
		});
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
	private async createPathFromDrawing(type: string | undefined, hexes: HexCoord[]): Promise<void> {
		if (!this.pathsFolder) return;
		const folder = this.pathsFolder;
		const fileName = uniqueFileName(this.nextDefaultPathName(), (candidate) =>
			!!this.app.vault.getAbstractFileByPath(normalizePath(`${folder.path}/${candidate}.md`)),
		);
		const path = normalizePath(`${folder.path}/${fileName}.md`);

		const lines = ["---"];
		if (type) lines.push(`path-type: ${JSON.stringify(type)}`);
		lines.push("path-hexes:");
		for (const h of hexes) lines.push(`  - [${h.q}, ${h.r}]`);
		lines.push("---", "");

		const file = await this.app.vault.create(path, lines.join("\n"));
		this.pathsList.push({ notePath: file.path, name: file.basename, type, hexes: [...hexes] });
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

	private async movePathPoint(path: PathData, index: number, q: number, r: number): Promise<void> {
		path.hexes[index] = { q, r };
		await this.savePathHexes(path);
		this.render();
	}

	private async insertPathPoint(
		state: Extract<PathToolState, { mode: "editing" }>,
		q: number,
		r: number,
	): Promise<void> {
		const at = state.insertAt ?? (state.addAtStart ? 0 : state.path.hexes.length);
		state.path.hexes.splice(at, 0, { q, r });
		state.insertAt = null;
		await this.savePathHexes(state.path);
		this.render();
	}

	private async removePathPoint(state: Extract<PathToolState, { mode: "editing" }>, index: number): Promise<void> {
		if (state.path.hexes.length <= 2) {
			new Notice("A path needs at least 2 points — use Delete Path to remove it entirely.");
			return;
		}
		state.path.hexes.splice(index, 1);
		await this.savePathHexes(state.path);
		this.render();
	}

	private async savePathHexes(path: PathData): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path.notePath);
		if (!(file instanceof TFile)) return;
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			fm["path-hexes"] = path.hexes.map((h) => [h.q, h.r]);
		});
	}
}
