/**
 * Pure hex-geometry math — no Obsidian or DOM dependencies.
 * Coordinates are offset row/col: "hex-q" is the column, "hex-r" is the row.
 * Pointy-top hexes stagger by row; flat-top hexes stagger by column.
 */

import type { HexCoord, HexOrientation, StaggerOffset } from "../types";

const SQRT3 = Math.sqrt(3);

export interface Pt {
	cx: number;
	cy: number;
}

/** Map key for a hex coordinate, shared by every layer/renderer keying off (q, r). */
export function hexKey(q: number, r: number): string {
	return `${q},${r}`;
}

/**
 * (width, height) of a single hex of the given radius and orientation.
 * Radius = distance from hex center to any vertex.
 */
export function hexSize(
	hexRadius: number,
	orientation: HexOrientation,
): { w: number; h: number } {
	return orientation === "flat"
		? { w: 2 * hexRadius, h: SQRT3 * hexRadius }
		: { w: SQRT3 * hexRadius, h: 2 * hexRadius };
}

function isShiftedLine(n: number, stagger: StaggerOffset): boolean {
	return stagger === "odd" ? n % 2 !== 0 : n % 2 === 0;
}

/**
 * Center pixel of the hex at grid (col, row) when the grid's top-left corner
 * is pinned to (0, 0).
 *
 * - Flat-top:  column spacing = 1.5R, row spacing = √3·R. Shifted columns
 *   are pushed down by half a hex height.
 * - Pointy-top: row spacing = 1.5R, column spacing = √3·R. Shifted rows
 *   are pushed right by half a hex width.
 *
 * `stagger` picks which parity is shifted — "odd" (default) means odd
 * rows/columns; "even" inverts that.
 */
export function hexCenter(
	col: number,
	row: number,
	orientation: HexOrientation,
	hexRadius: number,
	stagger: StaggerOffset = "odd",
): Pt {
	const { w, h } = hexSize(hexRadius, orientation);

	if (orientation === "flat") {
		const cx = hexRadius + col * 1.5 * hexRadius;
		const cy = h / 2 + row * h + (isShiftedLine(col, stagger) ? h / 2 : 0);
		return { cx, cy };
	}
	const cy = hexRadius + row * 1.5 * hexRadius;
	const cx = w / 2 + col * w + (isShiftedLine(row, stagger) ? w / 2 : 0);
	return { cx, cy };
}

/** Pixel bounding box for a full grid of hexes, for sizing the viewport. */
export function gridBoundingBox(
	cols: number,
	rows: number,
	orientation: HexOrientation,
	hexRadius: number,
	stagger: StaggerOffset = "odd",
): { width: number; height: number } {
	let maxRight = 0;
	let maxBottom = 0;
	const { w, h } = hexSize(hexRadius, orientation);
	for (const [col, row] of [
		[cols - 1, rows - 1],
		[cols - 1, Math.max(rows - 2, 0)],
		[Math.max(cols - 2, 0), rows - 1],
	]) {
		const c = hexCenter(col, row, orientation, hexRadius, stagger);
		maxRight = Math.max(maxRight, c.cx + w / 2);
		maxBottom = Math.max(maxBottom, c.cy + h / 2);
	}
	return { width: Math.ceil(maxRight), height: Math.ceil(maxBottom) };
}

/** The (up to 6) adjacent cells of (q, r), for the same stagger hexCenter uses. */
export function hexNeighbors(
	q: number,
	r: number,
	orientation: HexOrientation,
	stagger: StaggerOffset = "odd",
): HexCoord[] {
	const isShifted = (n: number) => isShiftedLine(n, stagger);

	if (orientation === "flat") {
		return !isShifted(q)
			? [
					{ q, r: r - 1 },
					{ q, r: r + 1 },
					{ q: q + 1, r: r - 1 },
					{ q: q + 1, r },
					{ q: q - 1, r: r - 1 },
					{ q: q - 1, r },
				]
			: [
					{ q, r: r - 1 },
					{ q, r: r + 1 },
					{ q: q + 1, r },
					{ q: q + 1, r: r + 1 },
					{ q: q - 1, r },
					{ q: q - 1, r: r + 1 },
				];
	}
	return !isShifted(r)
		? [
				{ q: q + 1, r },
				{ q: q - 1, r },
				{ q: q - 1, r: r - 1 },
				{ q, r: r - 1 },
				{ q: q - 1, r: r + 1 },
				{ q, r: r + 1 },
			]
		: [
				{ q: q + 1, r },
				{ q: q - 1, r },
				{ q, r: r - 1 },
				{ q: q + 1, r: r - 1 },
				{ q, r: r + 1 },
				{ q: q + 1, r: r + 1 },
			];
}

/** Straight polyline through the given points. */
export function sharpPath(pts: Pt[]): string {
	if (pts.length < 2) return "";
	return "M " + pts.map((p) => `${p.cx} ${p.cy}`).join(" L ");
}

/**
 * Smooth path through the given points: a chain of quadratic Beziers that
 * passes through each segment's midpoint, using the original points as
 * control points. Rounds corners without needing a spline library.
 */
export function smoothPath(pts: Pt[]): string {
	if (pts.length < 2) return "";
	if (pts.length === 2) {
		return `M ${pts[0].cx} ${pts[0].cy} L ${pts[1].cx} ${pts[1].cy}`;
	}
	const mx = (a: Pt, b: Pt) => (a.cx + b.cx) / 2;
	const my = (a: Pt, b: Pt) => (a.cy + b.cy) / 2;
	let d = `M ${pts[0].cx} ${pts[0].cy}`;
	d += ` L ${mx(pts[0], pts[1])} ${my(pts[0], pts[1])}`;
	for (let i = 1; i < pts.length - 1; i++) {
		d += ` Q ${pts[i].cx} ${pts[i].cy} ${mx(pts[i], pts[i + 1])} ${my(pts[i], pts[i + 1])}`;
	}
	d += ` L ${pts[pts.length - 1].cx} ${pts[pts.length - 1].cy}`;
	return d;
}
