import { Notice } from "obsidian";
import type { BorderData, HexCoord, HexcrawlBlockParams } from "../types";
import {
	addableEdges,
	edgeGeometry,
	offsetChain,
	offsetEdge,
} from "./borderGeometry";
import { DEFAULT_PATH_WIDTH, dashArray } from "./pathStyle";
import type { Pt } from "./hexGeometry";
import type { BorderToolState } from "./BorderTool";

const MIN_HITAREA_WIDTH = 14;

/** Called when an addable-edge dot is clicked, to let the caller prepend/append that pair. */
export type BorderAddEdgeHandler = (
	border: BorderData,
	which: "prepend" | "append",
	pair: [HexCoord, HexCoord],
) => void;

/** Called when the currently-edited border's first/last edge is right-clicked, to remove it. */
export type BorderRemoveEndHandler = (
	border: BorderData,
	which: "first" | "last",
) => void;

/**
 * Owns the borders layer's own SVG and draws it — one element per edge/pair (not one combined
 * multi-point path like PathLayer), since right-click-remove only applies to the first/last
 * edge and each edge is independently offset toward its own "right" hex anyway.
 */
export class BorderLayer {
	private svg: SVGSVGElement | null = null;
	/** A second SVG, mounted after every other layer so it always paints on top — the editing-
	 *  only affordances (add-edge dots, and the end-hitareas that back right-click-to-remove)
	 *  live here instead of in the main `svg`, since that one sits right above the terrain
	 *  layer and would otherwise have those affordances hidden underneath paths/icons wherever
	 *  a border's edge happens to run under one. */
	private overlaySvg: SVGSVGElement | null = null;
	private gutter = 0;
	private visible = true;

	constructor(private params: HexcrawlBlockParams) {}

	mount(
		viewportEl: HTMLElement,
		gutter: number,
		totalSize: { width: number; height: number },
	): void {
		this.svg = viewportEl.createSvg("svg", {
			cls: ["hexcrawl-layer", "hexcrawl-borders"],
			attr: { width: totalSize.width, height: totalSize.height },
		});
		this.svg.style.display = this.visible ? "" : "none";
		this.gutter = gutter;
	}

	/** Must be called after every other layer has mounted, so its z-order wins. */
	mountOverlay(
		viewportEl: HTMLElement,
		totalSize: { width: number; height: number },
	): void {
		this.overlaySvg = viewportEl.createSvg("svg", {
			cls: ["hexcrawl-layer", "hexcrawl-borders-overlay"],
			attr: { width: totalSize.width, height: totalSize.height },
		});
		this.overlaySvg.style.display = this.visible ? "" : "none";
	}

	setVisible(visible: boolean): void {
		this.visible = visible;
		if (this.svg) this.svg.style.display = visible ? "" : "none";
		if (this.overlaySvg) this.overlaySvg.style.display = visible ? "" : "none";
	}

	get isVisible(): boolean {
		return this.visible;
	}

	render(
		borders: BorderData[],
		state: BorderToolState,
		onAddEdge: BorderAddEdgeHandler,
		onRemoveEnd: BorderRemoveEndHandler,
	): void {
		const svg = this.svg;
		if (!svg) return;
		svg.empty();
		this.overlaySvg?.empty();
		const {
			orientation,
			hexSize: radius,
			palette,
			stagger,
			cols,
			rows,
		} = this.params;
		const gutter = this.gutter;
		const offsetPt = (p: Pt): Pt => ({ cx: gutter + p.cx, cy: gutter + p.cy });

		for (const border of borders) {
			const style = border.type ? palette?.borders[border.type] : undefined;
			const width = style?.width ?? DEFAULT_PATH_WIDTH;
			const isEditing =
				state.mode === "editing" && state.border.notePath === border.notePath;

			// Mitered as a whole chain, not edge-by-edge — offsetting each edge independently
			// would leave a gap/overlap at internal joints since neighboring edges shift along
			// different directions; offsetChain trims/extends each edge so joints still meet.
			const segments = offsetChain(
				border.pairs,
				style?.edgeOffset ?? 0,
				orientation,
				radius,
				stagger,
			);
			if (!segments) return; // shouldn't happen for an already-validated border

			border.pairs.forEach((pair, i) => {
				const shifted = segments[i];
				const start = offsetPt(shifted.start);
				const end = offsetPt(shifted.end);
				const d = `M ${start.cx} ${start.cy} L ${end.cx} ${end.cy}`;

				const segEl = svg.createSvg("path", {
					cls: border.type
						? ["hexcrawl-border", `hexcrawl-border-${border.type}`]
						: "hexcrawl-border",
					attr: { d, fill: "none", "data-note-path": border.notePath },
				});
				const color = style?.color ?? border.type;
				if (color) segEl.style.stroke = color;
				if (style?.width) segEl.style.strokeWidth = String(style.width);
				if (style?.dash)
					segEl.style.strokeDasharray = dashArray(style.dash, width);
				if (!border.name.startsWith("_"))
					segEl.createSvg("title").textContent = border.name;

				// Wider, invisible sibling so a thin/dashed line is still easy to click/select.
				const hitEl = svg.createSvg("path", {
					cls: "hexcrawl-border-hitarea",
					attr: { d, fill: "none", "data-note-path": border.notePath },
				});
				hitEl.style.strokeWidth = String(Math.max(width, MIN_HITAREA_WIDTH));

				// Right-click-to-remove only applies to the border currently being edited, and
				// only at either end — never the middle — mirroring how Path's point markers
				// (which also handle removal) only render in its own editing state. The listener
				// lives on a same-shaped hit path drawn into the topmost overlay (rather than on
				// `hitEl` itself) so a path/icon layered on top of this edge elsewhere can never
				// swallow the right-click before it reaches us.
				if (isEditing) {
					const isFirst = i === 0;
					const isLast = i === border.pairs.length - 1;
					if (isFirst || isLast) {
						const overlayHitEl = this.overlaySvg?.createSvg("path", {
							cls: "hexcrawl-border-hitarea",
							attr: { d, fill: "none" },
						});
						if (overlayHitEl) {
							overlayHitEl.style.strokeWidth = String(
								Math.max(width, MIN_HITAREA_WIDTH),
							);
							overlayHitEl.addEventListener("contextmenu", (e: MouseEvent) => {
								e.preventDefault();
								e.stopPropagation();
								onRemoveEnd(border, isFirst ? "first" : "last");
							});
						}
					} else {
						hitEl.addEventListener("contextmenu", (e: MouseEvent) => {
							e.preventDefault();
							e.stopPropagation();
							new Notice(
								"Can only remove an edge from either end of the border.",
							);
						});
					}
				}
			});

			if (isEditing && this.overlaySvg) {
				// Only reject a candidate edge if it's entirely off-grid — one hex outside is
				// the normal shape of a border capping the map's outer boundary.
				const hexInBounds = (h: HexCoord) =>
					h.q >= 0 && h.q < cols && h.r >= 0 && h.r < rows;
				const inBounds = (pair: [HexCoord, HexCoord]) => pair.some(hexInBounds);
				const { prepend, append } = addableEdges(
					border.pairs,
					orientation,
					radius,
					stagger,
				);
				for (const pair of prepend.filter(inBounds))
					this.renderAddDot(
						this.overlaySvg,
						pair,
						style?.edgeOffset ?? 0,
						orientation,
						radius,
						stagger,
						offsetPt,
						() => onAddEdge(border, "prepend", pair),
					);
				for (const pair of append.filter(inBounds))
					this.renderAddDot(
						this.overlaySvg,
						pair,
						style?.edgeOffset ?? 0,
						orientation,
						radius,
						stagger,
						offsetPt,
						() => onAddEdge(border, "append", pair),
					);
			}
		}
	}

	private renderAddDot(
		svg: SVGSVGElement,
		pair: [HexCoord, HexCoord],
		edgeOffsetPx: number,
		orientation: HexcrawlBlockParams["orientation"],
		radius: number,
		stagger: HexcrawlBlockParams["stagger"],
		offsetPt: (p: Pt) => Pt,
		onAdd: () => void,
	): void {
		const edge = edgeGeometry(pair[0], pair[1], orientation, radius, stagger);
		if (!edge) return;
		const shifted = offsetEdge(
			edge,
			pair[0],
			edgeOffsetPx,
			orientation,
			radius,
			stagger,
		);
		const mid = offsetPt({
			cx: (shifted.start.cx + shifted.end.cx) / 2,
			cy: (shifted.start.cy + shifted.end.cy) / 2,
		});
		const dot = svg.createSvg("circle", {
			cls: "hexcrawl-border-marker-add",
			attr: { cx: String(mid.cx), cy: String(mid.cy), r: "4" },
		});
		dot.addEventListener("pointerdown", (e: PointerEvent) => {
			e.stopPropagation();
			e.preventDefault();
			onAdd();
		});
	}
}
