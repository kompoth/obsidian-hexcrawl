import type { HexCoord, HexOrientation, StaggerOffset } from "../types";
import {
	hexCenter,
	hexKey,
	hexNeighbors,
	hexVertices,
	type Pt,
} from "./hexGeometry";

/** Topology (adjacency, chain validity, addable edges) doesn't depend on scale, so callers
 *  that only need topology can pass this instead of the block's real hexSize. */
export const REFERENCE_RADIUS = 1;

const EPSILON = 1e-6;

function samePt(a: Pt, b: Pt): boolean {
	return Math.abs(a.cx - b.cx) < EPSILON && Math.abs(a.cy - b.cy) < EPSILON;
}

function sameHex(a: HexCoord, b: HexCoord): boolean {
	return a.q === b.q && a.r === b.r;
}

/** Sorted, order-independent id of the 3 hexes meeting at one vertex — float-free, so chain
 *  continuity can be checked with a plain string comparison. */
function vertexId(a: HexCoord, b: HexCoord, c: HexCoord): string {
	return [a, b, c]
		.map((h) => hexKey(h.q, h.r))
		.sort()
		.join("|");
}

export interface EdgeGeometry {
	/** start -> end is the CCW walk around `pivot`'s own perimeter — the edge's "direction". */
	start: Pt;
	end: Pt;
	startVertexId: string;
	endVertexId: string;
}

/**
 * Geometry of the edge shared by two neighboring hexes, as seen from `pivot` (the pair's first
 * hex — `other` is always on the right of the resulting direction). Returns null if they aren't
 * neighbors.
 */
export function edgeGeometry(
	pivot: HexCoord,
	other: HexCoord,
	orientation: HexOrientation,
	hexRadius: number,
	stagger: StaggerOffset,
): EdgeGeometry | null {
	const pivotNeighbors = hexNeighbors(pivot.q, pivot.r, orientation, stagger);
	if (!pivotNeighbors.some((n) => sameHex(n, other))) return null;

	const pivotCenter = hexCenter(
		pivot.q,
		pivot.r,
		orientation,
		hexRadius,
		stagger,
	);
	const otherCenter = hexCenter(
		other.q,
		other.r,
		orientation,
		hexRadius,
		stagger,
	);
	const pivotVerts = hexVertices(
		pivotCenter.cx,
		pivotCenter.cy,
		orientation,
		hexRadius,
	);
	const otherVerts = hexVertices(
		otherCenter.cx,
		otherCenter.cy,
		orientation,
		hexRadius,
	);

	const sharedIdx: number[] = [];
	for (let i = 0; i < 6; i++) {
		if (otherVerts.some((v) => samePt(v, pivotVerts[i]))) sharedIdx.push(i);
	}
	if (sharedIdx.length !== 2) return null;

	// pivotVerts is in clockwise screen order; walking it counter-clockwise visits the two
	// shared indices in descending (wrapping) order.
	const [i1, i2] = sharedIdx;
	const adjacentForward = (i2 - i1 + 6) % 6 === 1;
	const [startIdx, endIdx] = adjacentForward ? [i2, i1] : [i1, i2];
	const start = pivotVerts[startIdx];
	const end = pivotVerts[endIdx];

	// The "third hex" at each vertex is whichever other common neighbor of pivot/other has
	// that same vertex among its own six.
	const otherNeighbors = hexNeighbors(other.q, other.r, orientation, stagger);
	const common = pivotNeighbors.filter((p) =>
		otherNeighbors.some((o) => sameHex(o, p)),
	);
	const thirdAt = (pt: Pt): HexCoord | undefined =>
		common.find((c) => {
			const cc = hexCenter(c.q, c.r, orientation, hexRadius, stagger);
			return hexVertices(cc.cx, cc.cy, orientation, hexRadius).some((v) =>
				samePt(v, pt),
			);
		});

	const startThird = thirdAt(start);
	const endThird = thirdAt(end);
	if (!startThird || !endThird) return null;

	return {
		start,
		end,
		startVertexId: vertexId(pivot, other, startThird),
		endVertexId: vertexId(pivot, other, endThird),
	};
}

/**
 * Validates a border's pairs against the three math-validation rules from todo.md:
 * 1. each pair's two hexes must be neighbors, 2/3. consecutive pairs must chain head-to-tail
 * (enforced via matching vertex ids — "exactly one shared hex" falls out for free, since
 * exactly 3 distinct hexes ever meet at a vertex).
 */
export function validateBorderPairs(
	pairs: [HexCoord, HexCoord][],
	orientation: HexOrientation,
	stagger: StaggerOffset,
	/** When given, every pair must have at least one hex inside [0, cols) x [0, rows) — omit
	 *  (as tests do) to validate topology only, independent of any particular grid's size. A
	 *  pair with exactly one hex outside the grid is still allowed: that's the normal shape of
	 *  a border edge capping the map's outer boundary, naming the phantom hex just past the
	 *  rim only to pin down which of the real hex's 6 sides is meant. Only a pair with *both*
	 *  hexes outside is rejected, since that would route the border through open space with no
	 *  connection to the map at all. */
	gridBounds?: { cols: number; rows: number },
): { ok: true } | { ok: false; error: string } {
	if (pairs.length === 0)
		return { ok: false, error: "border-hexes must have at least 1 pair" };

	if (gridBounds) {
		const inBounds = (h: HexCoord) =>
			h.q >= 0 && h.q < gridBounds.cols && h.r >= 0 && h.r < gridBounds.rows;
		for (const [a, b] of pairs) {
			if (!inBounds(a) && !inBounds(b)) {
				return {
					ok: false,
					error: `edge (${a.q},${a.r})-(${b.q},${b.r}) is entirely outside the map bounds`,
				};
			}
		}
	}

	const edges: (EdgeGeometry | null)[] = pairs.map(([a, b]) =>
		edgeGeometry(a, b, orientation, REFERENCE_RADIUS, stagger),
	);
	const badIdx = edges.findIndex((e) => e === null);
	if (badIdx !== -1) {
		const [a, b] = pairs[badIdx];
		return {
			ok: false,
			error: `pair ${badIdx}: (${a.q},${a.r}) and (${b.q},${b.r}) aren't neighbors`,
		};
	}
	for (let i = 1; i < edges.length; i++) {
		if (edges[i - 1]!.endVertexId !== edges[i]!.startVertexId) {
			return {
				ok: false,
				error: `pair ${i} doesn't continue head-to-tail from pair ${i - 1}`,
			};
		}
	}
	return { ok: true };
}

/**
 * Up to 2 legal new edges at each open end of a validated chain — the 2 non-degenerate options
 * out of the 3 possible edges at that end's shared vertex (the 3rd is retracing the edge just
 * arrived from, always geometrically valid but pointless). Assumes `chain` already validates.
 */
export function addableEdges(
	chain: [HexCoord, HexCoord][],
	orientation: HexOrientation,
	hexRadius: number,
	stagger: StaggerOffset,
): { prepend: [HexCoord, HexCoord][]; append: [HexCoord, HexCoord][] } {
	const commonNeighbor = (
		a: HexCoord,
		b: HexCoord,
		at: Pt,
	): HexCoord | undefined => {
		const an = hexNeighbors(a.q, a.r, orientation, stagger);
		const bn = hexNeighbors(b.q, b.r, orientation, stagger);
		const common = an.filter((p) => bn.some((o) => sameHex(o, p)));
		return common.find((c) => {
			const cc = hexCenter(c.q, c.r, orientation, hexRadius, stagger);
			return hexVertices(cc.cx, cc.cy, orientation, hexRadius).some((v) =>
				samePt(v, at),
			);
		});
	};

	const [P0, Q0] = chain[0];
	const [Pn, Qn] = chain[chain.length - 1];
	const eFirst = edgeGeometry(P0, Q0, orientation, hexRadius, stagger);
	const eLast = edgeGeometry(Pn, Qn, orientation, hexRadius, stagger);

	const prepend: [HexCoord, HexCoord][] = [];
	if (eFirst) {
		const T = commonNeighbor(P0, Q0, eFirst.start);
		if (T) prepend.push([P0, T], [T, Q0]);
	}
	const append: [HexCoord, HexCoord][] = [];
	if (eLast) {
		const T = commonNeighbor(Pn, Qn, eLast.end);
		if (T) append.push([Pn, T], [T, Qn]);
	}
	return { prepend, append };
}

/**
 * Shifts an edge's two pixel endpoints by `offsetPx` toward `towardHex`'s center — the
 * palette's per-border-type edge offset.
 */
export function offsetEdge(
	edge: { start: Pt; end: Pt },
	towardHex: HexCoord,
	offsetPx: number,
	orientation: HexOrientation,
	hexRadius: number,
	stagger: StaggerOffset,
): { start: Pt; end: Pt } {
	if (!offsetPx) return edge;
	const mid = {
		cx: (edge.start.cx + edge.end.cx) / 2,
		cy: (edge.start.cy + edge.end.cy) / 2,
	};
	const target = hexCenter(
		towardHex.q,
		towardHex.r,
		orientation,
		hexRadius,
		stagger,
	);
	const dx = target.cx - mid.cx;
	const dy = target.cy - mid.cy;
	const len = Math.hypot(dx, dy) || 1;
	const ux = (dx / len) * offsetPx;
	const uy = (dy / len) * offsetPx;
	return {
		start: { cx: edge.start.cx + ux, cy: edge.start.cy + uy },
		end: { cx: edge.end.cx + ux, cy: edge.end.cy + uy },
	};
}

/** Where infinite line (p1 + t*d1) meets (p2 + s*d2), or null if they're parallel. */
function lineIntersection(
	p1: Pt,
	d1: { x: number; y: number },
	p2: Pt,
	d2: { x: number; y: number },
): Pt | null {
	const denom = d1.x * d2.y - d1.y * d2.x;
	if (Math.abs(denom) < 1e-9) return null;
	const t = ((p2.cx - p1.cx) * d2.y - (p2.cy - p1.cy) * d2.x) / denom;
	return { cx: p1.cx + d1.x * t, cy: p1.cy + d1.y * t };
}

/**
 * Offsets a whole border chain, mitering the shared corner between every pair of consecutive
 * edges instead of translating each edge independently: a plain per-edge translation
 * (offsetEdge) leaves a gap or overlap at each internal joint, since two consecutive edges are
 * shifted along different directions. Here each internal joint is recomputed as the
 * intersection of its two neighboring edges' offset lines, which changes those edges' length —
 * the free ends of the whole chain (no neighbor to miter against) keep their naive offsetEdge
 * position. Returns null if any pair isn't a valid edge.
 *
 * Each edge shifts toward its own pair's first (pivot) hex — always the same side of the
 * chain's direction of travel (edgeGeometry guarantees the pivot is on the left of start->end
 * for every edge, regardless of the actual hexes involved), so the whole chain shifts
 * consistently to one side even around a corner.
 */
export function offsetChain(
	pairs: [HexCoord, HexCoord][],
	offsetPx: number,
	orientation: HexOrientation,
	hexRadius: number,
	stagger: StaggerOffset,
): { start: Pt; end: Pt }[] | null {
	const edges = pairs.map(([a, b]) =>
		edgeGeometry(a, b, orientation, hexRadius, stagger),
	);
	if (edges.some((e) => e === null)) return null;
	const realEdges = edges as EdgeGeometry[];

	const naive = realEdges.map((e, i) =>
		offsetEdge(e, pairs[i][0], offsetPx, orientation, hexRadius, stagger),
	);
	if (!offsetPx) return naive;

	const dir = (i: number) => ({
		x: realEdges[i].end.cx - realEdges[i].start.cx,
		y: realEdges[i].end.cy - realEdges[i].start.cy,
	});

	const result = naive.map((seg) => ({ start: seg.start, end: seg.end }));
	for (let i = 0; i < realEdges.length - 1; i++) {
		const joint = lineIntersection(
			naive[i].start,
			dir(i),
			naive[i + 1].start,
			dir(i + 1),
		);
		if (joint) {
			result[i].end = joint;
			result[i + 1].start = joint;
		}
	}
	return result;
}
