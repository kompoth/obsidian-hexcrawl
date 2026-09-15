import { describe, expect, it } from "vitest";
import {
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
