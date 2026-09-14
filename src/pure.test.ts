import { describe, expect, it } from "vitest";
import {
	dashArray,
	parseHexNoteFrontmatter,
	parsePathFrontmatter,
	renameKey,
	resolveIconsFolder,
	resolveNamedPalette,
	resolvePaletteEntry,
	uniqueFileName,
	uniqueKey,
} from "./pure";
import type { HexNoteData, Palette } from "./types";

describe("resolvePaletteEntry", () => {
	const palette: Palette = { terrain: { forest: { color: "green", icon: "tree" } }, paths: {} };
	const note = (terrain?: string): HexNoteData => ({ path: "p", name: "n", terrain });

	it("looks up the note's terrain in the palette", () => {
		expect(resolvePaletteEntry(note("forest"), palette)).toEqual({ color: "green", icon: "tree" });
	});

	it("returns undefined when the note has no terrain", () => {
		expect(resolvePaletteEntry(note(), palette)).toBeUndefined();
	});

	it("returns undefined when the terrain isn't in the palette", () => {
		expect(resolvePaletteEntry(note("swamp"), palette)).toBeUndefined();
	});

	it("returns undefined for an undefined note or palette", () => {
		expect(resolvePaletteEntry(undefined, palette)).toBeUndefined();
		expect(resolvePaletteEntry(note("forest"), undefined)).toBeUndefined();
	});
});

describe("resolveNamedPalette", () => {
	const a: Palette = { terrain: { a: {} }, paths: {} };
	const b: Palette = { terrain: { b: {} }, paths: {} };
	const settings = { palettes: { A: a, B: b }, defaultPalette: "A" };

	it("looks up a named palette", () => {
		expect(resolveNamedPalette("B", settings)).toBe(b);
	});

	it("falls back to the default palette when name is undefined", () => {
		expect(resolveNamedPalette(undefined, settings)).toBe(a);
	});

	it("returns undefined for an unknown name", () => {
		expect(resolveNamedPalette("nope", settings)).toBeUndefined();
	});

	it("returns undefined when the default itself is missing", () => {
		expect(resolveNamedPalette(undefined, { palettes: {}, defaultPalette: "gone" })).toBeUndefined();
	});
});

describe("resolveIconsFolder", () => {
	it("returns the palette's own icons folder", () => {
		expect(resolveIconsFolder({ palette: { terrain: {}, paths: {}, iconsFolder: "Palette/Icons" } })).toBe(
			"Palette/Icons",
		);
	});

	it("returns undefined when neither is set", () => {
		expect(resolveIconsFolder({})).toBeUndefined();
		expect(resolveIconsFolder({ palette: { terrain: {}, paths: {} } })).toBeUndefined();
	});
});

describe("parseHexNoteFrontmatter", () => {
	it("parses valid q/r plus terrain/icon", () => {
		expect(parseHexNoteFrontmatter({ "hex-q": 2, "hex-r": 3, "hex-terrain": "forest", "hex-icon": " tree " })).toEqual({
			q: 2,
			r: 3,
			terrain: "forest",
			icon: "tree",
		});
	});

	it("rejects missing or non-integer q/r", () => {
		expect(parseHexNoteFrontmatter({ "hex-r": 3 })).toBeNull();
		expect(parseHexNoteFrontmatter({ "hex-q": 1.5, "hex-r": 3 })).toBeNull();
		expect(parseHexNoteFrontmatter({ "hex-q": "not a number", "hex-r": 3 })).toBeNull();
	});

	it("coerces blank/non-string terrain and icon to undefined", () => {
		expect(parseHexNoteFrontmatter({ "hex-q": 0, "hex-r": 0, "hex-terrain": "  ", "hex-icon": 42 })).toEqual({
			q: 0,
			r: 0,
			terrain: undefined,
			icon: undefined,
		});
	});
});

describe("parsePathFrontmatter", () => {
	it("parses valid path-hexes plus type/spline", () => {
		expect(
			parsePathFrontmatter({
				"path-hexes": [[0, 0], [1, 0], [1, 1]],
				"path-type": "road",
				"path-spline": true,
			}),
		).toEqual({
			hexes: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 1, r: 1 }],
			type: "road",
			spline: true,
		});
	});

	it("filters out malformed pairs", () => {
		expect(parsePathFrontmatter({ "path-hexes": [[0, 0], "bad", [1, 0], [1]] })).toEqual({
			hexes: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
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

describe("dashArray", () => {
	it("returns none for solid", () => {
		expect(dashArray("solid", 3)).toBe("none");
	});

	it("scales dotted/dashed to the given width", () => {
		expect(dashArray("dotted", 10)).toBe("4 18");
		expect(dashArray("dashed", 10)).toBe("25 18");
	});
});

describe("uniqueFileName", () => {
	it("sanitizes special characters", () => {
		expect(uniqueFileName('a/b:c*d?e"f<g>h|i', () => false)).toBe("a-b-c-d-e-f-g-h-i");
	});

	it("falls back to 'Path' for a blank name", () => {
		expect(uniqueFileName("   ", () => false)).toBe("Path");
	});

	it("passes through when there's no collision", () => {
		expect(uniqueFileName("Road", () => false)).toBe("Road");
	});

	it("suffixes ' 2', ' 3', ... until a free name is found", () => {
		const taken = new Set(["Road", "Road 2", "Road 3"]);
		expect(uniqueFileName("Road", (candidate) => taken.has(candidate))).toBe("Road 4");
	});
});

describe("renameKey", () => {
	it("renames a key in place, preserving the other entries' order", () => {
		const record: Record<string, number> = { a: 1, b: 2, c: 3 };
		renameKey(record, "b", "z");
		expect(Object.keys(record)).toEqual(["a", "z", "c"]);
		expect(record.z).toBe(2);
		expect(record.b).toBeUndefined();
	});

	it("is a no-op when the key isn't found", () => {
		const record: Record<string, number> = { a: 1 };
		renameKey(record, "nope", "z");
		expect(record).toEqual({ a: 1 });
	});
});

describe("uniqueKey", () => {
	it("passes the base through when it's free", () => {
		expect(uniqueKey({}, "Terrain")).toBe("Terrain");
	});

	it("suffixes ' 2', ' 3', ... until a free key is found", () => {
		expect(uniqueKey({ Terrain: 1, "Terrain 2": 1 }, "Terrain")).toBe("Terrain 3");
	});
});
