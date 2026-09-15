import type { HexCoord, HexcrawlBlockParams, PathData } from "../types";
import { hexCenter, sharpPath, smoothPath } from "./hexGeometry";
import { DEFAULT_PATH_WIDTH, dashArray } from "./pathStyle";
import type { PathToolState } from "./PathTool";

const MIN_HITAREA_WIDTH = 14;

/** Called when a "move" marker is dragged onto a hex, to let the caller persist the change. */
export type PathPointDragHandler = (
	path: PathData,
	index: number,
	q: number,
	r: number,
) => void;

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
				attr: { d, fill: "none", "data-note-path": path.notePath },
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
				attr: { d, fill: "none", "data-note-path": path.notePath },
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
				if (state.sub === "move")
					this.attachMarkerDrag(marker, state.path, i, onPointDrag);
			});
			if (state.sub === "add") {
				for (let i = 0; i < points.length - 1; i++) {
					const mx = (points[i].cx + points[i + 1].cx) / 2;
					const my = (points[i].cy + points[i + 1].cy) / 2;
					svg.createSvg("circle", {
						cls: "hexcrawl-path-marker-add",
						attr: {
							cx: String(mx),
							cy: String(my),
							r: "4",
							"data-insert-at": String(i + 1),
						},
					});
				}
				// Extrapolated markers just beyond each end, for prepending/appending a point.
				if (points.length >= 2) {
					const first = points[0];
					const second = points[1];
					svg.createSvg("circle", {
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
					svg.createSvg("circle", {
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
	private attachMarkerDrag(
		markerEl: SVGCircleElement,
		path: PathData,
		index: number,
		onPointDrag: PathPointDragHandler,
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
					if (Number.isInteger(q) && Number.isInteger(r))
						onPointDrag(path, index, q, r);
				}
			};
			markerEl.addEventListener("pointermove", onMove);
			markerEl.addEventListener("pointerup", onUp);
		});
	}
}
