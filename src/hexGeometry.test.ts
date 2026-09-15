import { describe, expect, it } from "vitest";
import {
	gridBoundingBox,
	hexCenter,
	hexNeighbors,
	hexSize,
	sharpPath,
	smoothPath,
} from "./render/hexGeometry";

describe("hexSize", () => {
	it("flat-top: width is 2R, height is √3·R", () => {
		expect(hexSize(10, "flat")).toEqual({ w: 20, h: Math.sqrt(3) * 10 });
	});

	it("pointy-top: width is √3·R, height is 2R", () => {
		expect(hexSize(10, "pointy")).toEqual({ w: Math.sqrt(3) * 10, h: 20 });
	});
});

describe("hexCenter", () => {
	it("pointy-top, odd stagger: shifts odd rows right by half a hex width", () => {
		const row0 = hexCenter(0, 0, "pointy", 10, "odd");
		const row1 = hexCenter(0, 1, "pointy", 10, "odd");
		const { w } = hexSize(10, "pointy");
		expect(row1.cx - row0.cx).toBeCloseTo(w / 2);
	});

	it("pointy-top, even stagger: shifts even rows instead of odd", () => {
		const odd = hexCenter(0, 1, "pointy", 10, "even");
		const even = hexCenter(0, 0, "pointy", 10, "even");
		const { w } = hexSize(10, "pointy");
		expect(even.cx - odd.cx).toBeCloseTo(w / 2);
	});

	it("flat-top, odd stagger: shifts odd columns down by half a hex height", () => {
		const col0 = hexCenter(0, 0, "flat", 10, "odd");
		const col1 = hexCenter(1, 0, "flat", 10, "odd");
		const { h } = hexSize(10, "flat");
		expect(col1.cy - col0.cy).toBeCloseTo(h / 2);
	});
});

describe("gridBoundingBox", () => {
	it("matches a single hex's own extent", () => {
		const box = gridBoundingBox(1, 1, "pointy", 10, "odd");
		const { w, h } = hexSize(10, "pointy");
		expect(box).toEqual({ width: Math.ceil(w), height: Math.ceil(h) });
	});
});

describe("hexNeighbors", () => {
	it("pointy-top has 6 neighbors", () => {
		expect(hexNeighbors(2, 2, "pointy", "odd")).toHaveLength(6);
	});

	it("flat-top has 6 neighbors", () => {
		expect(hexNeighbors(2, 2, "flat", "odd")).toHaveLength(6);
	});

	it("differs between shifted and unshifted rows (pointy-top)", () => {
		const unshifted = hexNeighbors(2, 2, "pointy", "odd");
		const shifted = hexNeighbors(2, 3, "pointy", "odd");
		expect(unshifted).not.toEqual(shifted);
	});
});

describe("sharpPath", () => {
	it("returns empty string for fewer than 2 points", () => {
		expect(sharpPath([])).toBe("");
		expect(sharpPath([{ cx: 1, cy: 1 }])).toBe("");
	});

	it("draws a straight line through all points", () => {
		expect(
			sharpPath([
				{ cx: 0, cy: 0 },
				{ cx: 10, cy: 0 },
				{ cx: 10, cy: 10 },
			]),
		).toBe("M 0 0 L 10 0 L 10 10");
	});
});

describe("smoothPath", () => {
	it("returns empty string for fewer than 2 points", () => {
		expect(smoothPath([])).toBe("");
	});

	it("is a straight line for exactly 2 points", () => {
		expect(
			smoothPath([
				{ cx: 0, cy: 0 },
				{ cx: 10, cy: 0 },
			]),
		).toBe("M 0 0 L 10 0");
	});

	it("uses quadratic Beziers through midpoints for 3+ points", () => {
		const d = smoothPath([
			{ cx: 0, cy: 0 },
			{ cx: 10, cy: 0 },
			{ cx: 10, cy: 10 },
		]);
		expect(d.startsWith("M 0 0 L 5 0")).toBe(true);
		expect(d).toContain("Q 10 0 10 5");
		expect(d.endsWith("L 10 10")).toBe(true);
	});
});
