import { describe, expect, it } from "vitest";
import { dashArray } from "../src/render/pathStyle";

describe("dashArray", () => {
	it("returns none for solid", () => {
		expect(dashArray("solid", 3)).toBe("none");
	});

	it("scales dotted/dashed to the given width", () => {
		expect(dashArray("dotted", 10)).toBe("4 18");
		expect(dashArray("dashed", 10)).toBe("25 18");
	});
});
