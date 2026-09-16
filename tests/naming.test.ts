import { describe, expect, it } from "vitest";
import { renameKey, uniqueFileName, uniqueKey } from "../src/naming";

describe("uniqueFileName", () => {
	it("sanitizes special characters", () => {
		expect(uniqueFileName('a/b:c*d?e"f<g>h|i', () => false)).toBe(
			"a-b-c-d-e-f-g-h-i",
		);
	});

	it("falls back to 'Path' for a blank name", () => {
		expect(uniqueFileName("   ", () => false)).toBe("Path");
	});

	it("passes through when there's no collision", () => {
		expect(uniqueFileName("Road", () => false)).toBe("Road");
	});

	it("suffixes ' 2', ' 3', ... until a free name is found", () => {
		const taken = new Set(["Road", "Road 2", "Road 3"]);
		expect(uniqueFileName("Road", (candidate) => taken.has(candidate))).toBe(
			"Road 4",
		);
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
		expect(uniqueKey({ Terrain: 1, "Terrain 2": 1 }, "Terrain")).toBe(
			"Terrain 3",
		);
	});
});
