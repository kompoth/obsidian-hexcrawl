import { describe, expect, it } from "vitest";
import {
	addableEdges,
	edgeGeometry,
	offsetChain,
	offsetEdge,
	validateBorderPairs,
} from "../src/render/borderGeometry";
import { hexCenter, hexNeighbors } from "../src/render/hexGeometry";
import type { HexCoord, HexOrientation, StaggerOffset } from "../src/types";

const R = 10;
const ORIENTATIONS: HexOrientation[] = ["pointy", "flat"];
const STAGGERS: StaggerOffset[] = ["odd", "even"];

/** Signed area of (a,b,p) — used to tell which side of a->b a point falls on. */
function side(
	p: { cx: number; cy: number },
	a: { cx: number; cy: number },
	b: { cx: number; cy: number },
): number {
	return (b.cx - a.cx) * (p.cy - a.cy) - (b.cy - a.cy) * (p.cx - a.cx);
}

describe("edgeGeometry", () => {
	it("returns null for non-neighboring hexes", () => {
		expect(
			edgeGeometry({ q: 0, r: 0 }, { q: 5, r: 5 }, "pointy", R, "odd"),
		).toBeNull();
	});

	it("finds the two vertices shared by pivot and other", () => {
		const pivot: HexCoord = { q: 0, r: 0 };
		const other: HexCoord = { q: 1, r: 0 };
		const edge = edgeGeometry(pivot, other, "pointy", R, "odd");
		expect(edge).not.toBeNull();
	});

	it("the pivot is always on the left, and `other` always on the right, of start->end", () => {
		let checked = 0;
		for (const orientation of ORIENTATIONS) {
			for (const stagger of STAGGERS) {
				for (let q = -3; q <= 3; q++) {
					for (let r = -3; r <= 3; r++) {
						const pivot: HexCoord = { q, r };
						for (const other of hexNeighbors(q, r, orientation, stagger)) {
							const edge = edgeGeometry(pivot, other, orientation, R, stagger);
							expect(edge).not.toBeNull();
							if (!edge) continue;
							const pivotCenter = hexCenter(
								pivot.q,
								pivot.r,
								orientation,
								R,
								stagger,
							);
							const otherCenter = hexCenter(
								other.q,
								other.r,
								orientation,
								R,
								stagger,
							);
							const pivotSide = side(pivotCenter, edge.start, edge.end);
							const otherSide = side(otherCenter, edge.start, edge.end);
							expect(Math.sign(pivotSide)).toBe(-1);
							expect(Math.sign(otherSide)).toBe(1);
							checked++;
						}
					}
				}
			}
		}
		expect(checked).toBeGreaterThan(100);
	});

	it("start/end vertex ids are order-independent (reversing pivot/other swaps them)", () => {
		const a: HexCoord = { q: 0, r: 0 };
		const b: HexCoord = { q: 1, r: 0 };
		const ab = edgeGeometry(a, b, "pointy", R, "odd")!;
		const ba = edgeGeometry(b, a, "pointy", R, "odd")!;
		// Reversing pivot/other reverses direction: ab's start/end swap relative to ba's.
		expect(ab.startVertexId).toBe(ba.endVertexId);
		expect(ab.endVertexId).toBe(ba.startVertexId);
	});
});

describe("validateBorderPairs", () => {
	it("rejects an empty pairs array", () => {
		expect(validateBorderPairs([], "pointy", "odd")).toEqual({
			ok: false,
			error: expect.any(String),
		});
	});

	it("rejects a pair of non-neighbors", () => {
		const result = validateBorderPairs(
			[
				[
					{ q: 0, r: 0 },
					{ q: 9, r: 9 },
				],
			],
			"pointy",
			"odd",
		);
		expect(result.ok).toBe(false);
	});

	it("accepts a single pair", () => {
		const result = validateBorderPairs(
			[
				[
					{ q: 0, r: 0 },
					{ q: 1, r: 0 },
				],
			],
			"pointy",
			"odd",
		);
		expect(result).toEqual({ ok: true });
	});

	it("accepts a head-to-tail chain, including one that turns a corner around one hex", () => {
		// Two edges of hex (1,1), pivoting on the same hex — a corner turn.
		const pivot: HexCoord = { q: 1, r: 1 };
		const neighbors = hexNeighbors(pivot.q, pivot.r, "pointy", "odd");
		let corner: [HexCoord, HexCoord][] | null = null;
		outer: for (const n0 of neighbors) {
			for (const n1 of neighbors) {
				if (n0.q === n1.q && n0.r === n1.r) continue;
				const e0 = edgeGeometry(pivot, n0, "pointy", R, "odd");
				const e1 = edgeGeometry(pivot, n1, "pointy", R, "odd");
				if (e0 && e1 && e0.endVertexId === e1.startVertexId) {
					corner = [
						[pivot, n0],
						[pivot, n1],
					];
					break outer;
				}
			}
		}
		expect(corner).not.toBeNull();
		expect(validateBorderPairs(corner!, "pointy", "odd")).toEqual({ ok: true });
	});

	it("rejects a chain broken by reversing the direction of a pair", () => {
		// [A,B] then [B,C] is valid; [A,B] then [C,B] (both ending at the same vertex) is not.
		const a: HexCoord = { q: 0, r: 0 };
		const b: HexCoord = { q: 1, r: 0 };
		const eAB = edgeGeometry(a, b, "pointy", R, "odd")!;
		const c = hexNeighbors(b.q, b.r, "pointy", "odd").find((n) => {
			const e = edgeGeometry(b, n, "pointy", R, "odd");
			return e && e.startVertexId === eAB.endVertexId;
		})!;
		const valid = validateBorderPairs(
			[
				[a, b],
				[b, c],
			],
			"pointy",
			"odd",
		);
		expect(valid).toEqual({ ok: true });
		const broken = validateBorderPairs(
			[
				[a, b],
				[c, b],
			],
			"pointy",
			"odd",
		);
		expect(broken.ok).toBe(false);
	});
});

describe("addableEdges", () => {
	it("returns exactly 2 append and 2 prepend candidates, both chaining validly", () => {
		const chain: [HexCoord, HexCoord][] = [
			[
				{ q: 0, r: 0 },
				{ q: 1, r: 0 },
			],
		];
		const { prepend, append } = addableEdges(chain, "pointy", R, "odd");
		expect(prepend).toHaveLength(2);
		expect(append).toHaveLength(2);

		for (const pair of append) {
			expect(validateBorderPairs([...chain, pair], "pointy", "odd")).toEqual({
				ok: true,
			});
		}
		for (const pair of prepend) {
			expect(validateBorderPairs([pair, ...chain], "pointy", "odd")).toEqual({
				ok: true,
			});
		}
	});

	it("never returns the retrace edge (the reverse of the chain's own end pair)", () => {
		const chain: [HexCoord, HexCoord][] = [
			[
				{ q: 0, r: 0 },
				{ q: 1, r: 0 },
			],
		];
		const { append } = addableEdges(chain, "pointy", R, "odd");
		const isRetrace = ([x, y]: [HexCoord, HexCoord]) =>
			x.q === 1 && x.r === 0 && y.q === 0 && y.r === 0;
		expect(append.some(isRetrace)).toBe(false);
	});
});

describe("offsetEdge", () => {
	it("returns the edge unchanged for a zero offset", () => {
		const edge = edgeGeometry(
			{ q: 0, r: 0 },
			{ q: 1, r: 0 },
			"pointy",
			R,
			"odd",
		)!;
		expect(offsetEdge(edge, { q: 1, r: 0 }, 0, "pointy", R, "odd")).toEqual(
			edge,
		);
	});

	it("shifts both endpoints toward the right hex's center by the given distance", () => {
		const pair: [HexCoord, HexCoord] = [
			{ q: 0, r: 0 },
			{ q: 1, r: 0 },
		];
		const edge = edgeGeometry(pair[0], pair[1], "pointy", R, "odd")!;
		const shifted = offsetEdge(edge, pair[1], 2, "pointy", R, "odd");
		const dStart = Math.hypot(
			shifted.start.cx - edge.start.cx,
			shifted.start.cy - edge.start.cy,
		);
		const dEnd = Math.hypot(
			shifted.end.cx - edge.end.cx,
			shifted.end.cy - edge.end.cy,
		);
		expect(dStart).toBeCloseTo(2);
		expect(dEnd).toBeCloseTo(2);

		// Shifted midpoint must be strictly closer to the right hex's center than the original.
		const rightCenter = hexCenter(pair[1].q, pair[1].r, "pointy", R, "odd");
		const mid = (p: {
			start: { cx: number; cy: number };
			end: { cx: number; cy: number };
		}) => ({
			cx: (p.start.cx + p.end.cx) / 2,
			cy: (p.start.cy + p.end.cy) / 2,
		});
		const distTo = (p: { cx: number; cy: number }) =>
			Math.hypot(p.cx - rightCenter.cx, p.cy - rightCenter.cy);
		expect(distTo(mid(shifted))).toBeLessThan(distTo(mid(edge)));
	});
});

describe("offsetChain", () => {
	function findCornerChain(): [HexCoord, HexCoord][] {
		const pivot: HexCoord = { q: 1, r: 1 };
		const neighbors = hexNeighbors(pivot.q, pivot.r, "pointy", "odd");
		for (const n0 of neighbors) {
			for (const n1 of neighbors) {
				if (n0.q === n1.q && n0.r === n1.r) continue;
				const e0 = edgeGeometry(pivot, n0, "pointy", R, "odd");
				const e1 = edgeGeometry(pivot, n1, "pointy", R, "odd");
				if (e0 && e1 && e0.endVertexId === e1.startVertexId) {
					return [
						[pivot, n0],
						[pivot, n1],
					];
				}
			}
		}
		throw new Error("no corner chain found");
	}

	it("returns null if any pair is invalid", () => {
		const chain: [HexCoord, HexCoord][] = [
			[
				{ q: 0, r: 0 },
				{ q: 9, r: 9 },
			],
		];
		expect(offsetChain(chain, 2, "pointy", R, "odd")).toBeNull();
	});

	it("returns the raw edges unchanged for a zero offset", () => {
		const chain = findCornerChain();
		const segments = offsetChain(chain, 0, "pointy", R, "odd")!;
		const edges = chain.map(([a, b]) =>
			edgeGeometry(a, b, "pointy", R, "odd")!,
		);
		expect(segments.map((s) => ({ start: s.start, end: s.end }))).toEqual(
			edges.map((e) => ({ start: e.start, end: e.end })),
		);
	});

	it("a single-edge chain has no joint to miter, matching plain offsetEdge", () => {
		const pair: [HexCoord, HexCoord] = [
			{ q: 0, r: 0 },
			{ q: 1, r: 0 },
		];
		const edge = edgeGeometry(pair[0], pair[1], "pointy", R, "odd")!;
		const expected = offsetEdge(edge, pair[0], 3, "pointy", R, "odd");
		expect(offsetChain([pair], 3, "pointy", R, "odd")).toEqual([expected]);
	});

	it("miters the shared corner of a 2-edge chain: the two segments meet at one point", () => {
		const chain = findCornerChain();
		const segments = offsetChain(chain, 3, "pointy", R, "odd")!;
		expect(segments[0].end.cx).toBeCloseTo(segments[1].start.cx);
		expect(segments[0].end.cy).toBeCloseTo(segments[1].start.cy);
	});

	it("mitering changes edge length rather than just translating it", () => {
		const chain = findCornerChain();
		const segments = offsetChain(chain, 3, "pointy", R, "odd")!;
		const edge0 = edgeGeometry(chain[0][0], chain[0][1], "pointy", R, "odd")!;
		const naive0 = offsetEdge(edge0, chain[0][1], 3, "pointy", R, "odd");
		const originalLength = Math.hypot(
			edge0.end.cx - edge0.start.cx,
			edge0.end.cy - edge0.start.cy,
		);
		const miteredLength = Math.hypot(
			segments[0].end.cx - segments[0].start.cx,
			segments[0].end.cy - segments[0].start.cy,
		);
		// The naive (un-mitered) translation would have kept the original length exactly.
		expect(
			Math.hypot(
				naive0.end.cx - naive0.start.cx,
				naive0.end.cy - naive0.start.cy,
			),
		).toBeCloseTo(originalLength);
		expect(miteredLength).not.toBeCloseTo(originalLength, 1);
	});
});
