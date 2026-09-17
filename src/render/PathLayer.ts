import type { HexCoord, HexcrawlBlockParams, PathData } from "../types";
import { hexCenter, sharpPath, smoothPath } from "./hexGeometry";
import { DEFAULT_PATH_WIDTH, dashArray } from "./pathStyle";
import type { PathToolState } from "./PathTool";

const MIN_HITAREA_WIDTH = 14;

/** Called when a point marker is dragged onto a hex, to let the caller move that point there. */
export type PathPointDragHandler = (
	path: PathData,
	index: number,
	q: number,
	r: number,
) => void;

/** Called when a midpoint marker is dragged onto a hex, to let the caller insert a new point
 *  there (at the given index) between its two neighbors. */
export type PathMidpointDropHandler = (
	path: PathData,
	insertAt: number,
	q: number,
	r: number,
) => void;

/** Called when a point marker is right-clicked, to let the caller remove that point. */
export type PathPointRemoveHandler = (path: PathData, index: number) => void;

/** Owns the paths layer's own SVG and draws it — the saved paths plus, if the Path tool is
 *  mid-draw or mid-edit, the in-progress preview line and/or point markers. */
export class PathLayer {
	private svg: SVGSVGElement | null = null;
	private gutter = 0;
	private visible = true;

	constructor(private params: HexcrawlBlockParams) {}

	/** Creates the paths layer's own SVG under viewportEl (always, even with zero paths yet, so the
	 *  Path tool can add the map's first path without a full grid re-render). */
	mount(
		viewportEl: HTMLElement,
		gutter: number,
		totalSize: { width: number; height: number },
	): void {
		this.svg = viewportEl.createSvg("svg", {
			cls: ["hexcrawl-layer", "hexcrawl-paths"],
			attr: { width: totalSize.width, height: totalSize.height },
		});
		this.svg.style.display = this.visible ? "" : "none";
		this.gutter = gutter;
	}

	setVisible(visible: boolean): void {
		this.visible = visible;
		if (this.svg) this.svg.style.display = visible ? "" : "none";
	}

	get isVisible(): boolean {
		return this.visible;
	}

	/**
	 * (Re)draws every path plus, if the Path tool is mid-draw or mid-edit, the in-progress
	 * preview line and/or point markers. Called after every path mutation instead of rebuilding
	 * the whole grid, so pan/zoom/tool state survives.
	 */
	render(
		paths: PathData[],
		state: PathToolState,
		onPointDrag: PathPointDragHandler,
		onMidpointDrop: PathMidpointDropHandler,
		onPointRemove: PathPointRemoveHandler,
	): void {
		const svg = this.svg;
		if (!svg) return;
		svg.empty();
		const { orientation, hexSize: radius, palette, stagger } = this.params;
		const gutter = this.gutter;
		const toPt = (h: HexCoord) => {
			const c = hexCenter(h.q, h.r, orientation, radius, stagger);
			return { cx: gutter + c.cx, cy: gutter + c.cy };
		};

		for (const path of paths) {
			const points = path.hexes.map(toPt);
			const style = path.type ? palette?.paths[path.type] : undefined;
			const spline = path.spline ?? style?.spline ?? false;
			const d = spline ? smoothPath(points) : sharpPath(points);
			const width = style?.width ?? DEFAULT_PATH_WIDTH;

			const pathEl = svg.createSvg("path", {
				cls: path.type
					? ["hexcrawl-path", `hexcrawl-path-${path.type}`]
					: "hexcrawl-path",
				attr: { d, fill: "none", "data-note-path": path.file.path },
			});
			const color = style?.color ?? path.type;
			if (color) pathEl.style.stroke = color;
			if (style?.width) pathEl.style.strokeWidth = String(style.width);
			if (style?.dash)
				pathEl.style.strokeDasharray = dashArray(style.dash, width);
			if (!path.name.startsWith("_"))
				pathEl.createSvg("title").textContent = path.name;

			// Wider, invisible sibling so a thin/dashed line is still easy to click/select.
			const hitEl = svg.createSvg("path", {
				cls: "hexcrawl-path-hitarea",
				attr: { d, fill: "none", "data-note-path": path.file.path },
			});
			hitEl.style.strokeWidth = String(Math.max(width, MIN_HITAREA_WIDTH));
		}

		if (state.mode === "drawing") {
			const points = state.hexes.map(toPt);
			if (points.length >= 2) {
				const style = state.type ? palette?.paths[state.type] : undefined;
				const width = style?.width ?? DEFAULT_PATH_WIDTH;
				const d = style?.spline ? smoothPath(points) : sharpPath(points);
				const previewEl = svg.createSvg("path", {
					cls: "hexcrawl-path-preview",
					attr: { d, fill: "none" },
				});
				if (style?.color) previewEl.style.stroke = style.color;
				if (style?.width) previewEl.style.strokeWidth = String(style.width);
				previewEl.style.strokeDasharray = style?.dash
					? dashArray(style.dash, width)
					: "none";
			}
			for (const p of points) {
				svg.createSvg("circle", {
					cls: "hexcrawl-path-marker",
					attr: { cx: String(p.cx), cy: String(p.cy), r: "5" },
				});
			}
		}

		if (state.mode === "editing") {
			const points = state.path.hexes.map(toPt);
			points.forEach((p, i) => {
				const marker = svg.createSvg("circle", {
					cls: "hexcrawl-path-marker",
					attr: {
						cx: String(p.cx),
						cy: String(p.cy),
						r: "6",
						"data-index": String(i),
					},
				});
				this.attachMarkerDrag(marker, (q, r) =>
					onPointDrag(state.path, i, q, r),
				);
				this.attachMarkerRemove(marker, () => onPointRemove(state.path, i));
			});
			// Midpoints are always shown while editing — dragging one onto a hex inserts a
			// new point there, between its two neighbors.
			for (let i = 0; i < points.length - 1; i++) {
				const mx = (points[i].cx + points[i + 1].cx) / 2;
				const my = (points[i].cy + points[i + 1].cy) / 2;
				const insertAt = i + 1;
				const midpoint = svg.createSvg("circle", {
					cls: "hexcrawl-path-marker-add",
					attr: { cx: String(mx), cy: String(my), r: "4" },
				});
				this.attachMarkerDrag(midpoint, (q, r) =>
					onMidpointDrop(state.path, insertAt, q, r),
				);
			}
		}
	}

	/** Drag-to-drop for a marker; calls onDrop with whichever hex the pointer is over on release. */
	private attachMarkerDrag(
		markerEl: SVGCircleElement,
		onDrop: (q: number, r: number) => void,
	): void {
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
					if (Number.isInteger(q) && Number.isInteger(r)) onDrop(q, r);
				}
			};
			markerEl.addEventListener("pointermove", onMove);
			markerEl.addEventListener("pointerup", onUp);
		});
	}

	/** Right-click-to-remove for a point marker. */
	private attachMarkerRemove(
		markerEl: SVGCircleElement,
		onRemove: () => void,
	): void {
		markerEl.addEventListener("contextmenu", (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			onRemove();
		});
	}
}
