import { describe, expect, it } from "vitest";
import {
	parseBorderFrontmatter,
	parseHexNoteFrontmatter,
	parsePathFrontmatter,
} from "../src/frontmatter";

describe("parseHexNoteFrontmatter", () => {
	it("parses valid q/r plus terrain/icon/gm-icon", () => {
		expect(
			parseHexNoteFrontmatter({
				"hex-q": 2,
				"hex-r": 3,
				"hex-terrain": "forest",
				"hex-icon": " tree ",
				"hex-gm-icon": " secret-lair ",
			}),
		).toEqual({
			q: 2,
			r: 3,
			terrain: "forest",
			icon: "tree",
			gmIcon: "secret-lair",
		});
	});

	it("rejects missing or non-integer q/r", () => {
		expect(parseHexNoteFrontmatter({ "hex-r": 3 })).toBeNull();
		expect(parseHexNoteFrontmatter({ "hex-q": 1.5, "hex-r": 3 })).toBeNull();
		expect(
			parseHexNoteFrontmatter({ "hex-q": "not a number", "hex-r": 3 }),
		).toBeNull();
	});

	it("coerces blank/non-string terrain, icon, and gm-icon to undefined", () => {
		expect(
			parseHexNoteFrontmatter({
				"hex-q": 0,
				"hex-r": 0,
				"hex-terrain": "  ",
				"hex-icon": 42,
				"hex-gm-icon": "  ",
			}),
		).toEqual({
			q: 0,
			r: 0,
			terrain: undefined,
			icon: undefined,
			gmIcon: undefined,
		});
	});
});

describe("parsePathFrontmatter", () => {
	it("parses valid path-hexes plus type/spline", () => {
		expect(
			parsePathFrontmatter({
				"path-hexes": [
					[0, 0],
					[1, 0],
					[1, 1],
				],
				"path-type": "road",
				"path-spline": true,
			}),
		).toEqual({
			hexes: [
				{ q: 0, r: 0 },
				{ q: 1, r: 0 },
				{ q: 1, r: 1 },
			],
			type: "road",
			spline: true,
		});
	});

	it("filters out malformed pairs", () => {
		expect(
			parsePathFrontmatter({ "path-hexes": [[0, 0], "bad", [1, 0], [1]] }),
		).toEqual({
			hexes: [
				{ q: 0, r: 0 },
				{ q: 1, r: 0 },
			],
			type: undefined,
			spline: undefined,
		});
	});

	it("rejects fewer than 2 valid points", () => {
		expect(parsePathFrontmatter({ "path-hexes": [[0, 0]] })).toBeNull();
	});

	it("rejects a non-array path-hexes", () => {
		expect(parsePathFrontmatter({ "path-hexes": "nope" })).toBeNull();
	});
});

describe("parseBorderFrontmatter", () => {
	it("parses valid border-hexes plus type", () => {
		expect(
			parseBorderFrontmatter({
				"border-hexes": [
					[
						[0, 0],
						[1, 1],
					],
					[
						[1, 1],
						[0, 1],
					],
				],
				"border-type": "barrier",
			}),
		).toEqual({
			ok: true,
			type: "barrier",
			pairs: [
				[
					{ q: 0, r: 0 },
					{ q: 1, r: 1 },
				],
				[
					{ q: 1, r: 1 },
					{ q: 0, r: 1 },
				],
			],
		});
	});

	it("accepts a single pair (a border may have just one edge)", () => {
		const result = parseBorderFrontmatter({
			"border-hexes": [
				[
					[0, 0],
					[1, 0],
				],
			],
		});
		expect(result.ok).toBe(true);
	});

	it("trims blank border-type to undefined", () => {
		const result = parseBorderFrontmatter({
			"border-hexes": [
				[
					[0, 0],
					[1, 0],
				],
			],
			"border-type": "  ",
		});
		expect(result).toMatchObject({ ok: true, type: undefined });
	});

	it("fails the whole note on a single malformed pair, unlike path-hexes' per-entry filtering", () => {
		const result = parseBorderFrontmatter({
			"border-hexes": [
				[
					[0, 0],
					[1, 0],
				],
				"bad",
			],
		});
		expect(result.ok).toBe(false);
	});

	it("fails on a pair with an invalid hex coordinate", () => {
		const result = parseBorderFrontmatter({
			"border-hexes": [[[0, 0], [1]]],
		});
		expect(result.ok).toBe(false);
	});

	it("rejects an empty border-hexes array", () => {
		expect(parseBorderFrontmatter({ "border-hexes": [] }).ok).toBe(false);
	});

	it("rejects a non-array border-hexes", () => {
		expect(parseBorderFrontmatter({ "border-hexes": "nope" }).ok).toBe(false);
	});
});
