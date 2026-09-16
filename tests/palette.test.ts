import { describe, expect, it } from "vitest";
import {
	resolveGmIconName,
	resolveIconsFolder,
	resolveNamedPalette,
	resolvePaletteEntry,
} from "../src/palette";
import type { HexNoteData, Palette } from "../src/types";

describe("resolvePaletteEntry", () => {
	const palette: Palette = {
		terrain: { forest: { color: "green", icon: "tree" } },
		paths: {},
		borders: {},
	};
	const note = (terrain?: string): HexNoteData => ({
		path: "p",
		name: "n",
		terrain,
	});

	it("looks up the note's terrain in the palette", () => {
		expect(resolvePaletteEntry(note("forest"), palette)).toEqual({
			color: "green",
			icon: "tree",
		});
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
	const a: Palette = { terrain: { a: {} }, paths: {}, borders: {} };
	const b: Palette = { terrain: { b: {} }, paths: {}, borders: {} };
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
		expect(
			resolveNamedPalette(undefined, { palettes: {}, defaultPalette: "gone" }),
		).toBeUndefined();
	});
});

describe("resolveGmIconName", () => {
	const note = (gmIcon?: string): HexNoteData => ({
		path: "p",
		name: "n",
		gmIcon,
	});

	it("returns the note's own hex-gm-icon value", () => {
		expect(resolveGmIconName(note("secret-lair"))).toBe("secret-lair");
	});

	it("returns undefined when the note has no hex-gm-icon", () => {
		expect(resolveGmIconName(note())).toBeUndefined();
	});

	it("returns undefined for an undefined note", () => {
		expect(resolveGmIconName(undefined)).toBeUndefined();
	});
});

describe("resolveIconsFolder", () => {
	it("returns the palette's own icons folder", () => {
		expect(
			resolveIconsFolder({
				palette: {
					terrain: {},
					paths: {},
					borders: {},
					iconsFolder: "Palette/Icons",
				},
			}),
		).toBe("Palette/Icons");
	});

	it("returns undefined when neither is set", () => {
		expect(resolveIconsFolder({})).toBeUndefined();
		expect(
			resolveIconsFolder({ palette: { terrain: {}, paths: {}, borders: {} } }),
		).toBeUndefined();
	});
});
