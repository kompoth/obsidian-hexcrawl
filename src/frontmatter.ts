import type { HexCoord } from "./types";

export function parseHexNoteFrontmatter(
	frontmatter: Record<string, unknown>,
): { q: number; r: number; terrain?: string; icon?: string } | null {
	const q = Number(frontmatter["hex-q"]);
	const r = Number(frontmatter["hex-r"]);
	if (!Number.isInteger(q) || !Number.isInteger(r)) return null;
	const terrainRaw = frontmatter["hex-terrain"];
	const terrain =
		typeof terrainRaw === "string" && terrainRaw.trim()
			? terrainRaw
			: undefined;
	const iconRaw = frontmatter["hex-icon"];
	const icon =
		typeof iconRaw === "string" && iconRaw.trim() ? iconRaw.trim() : undefined;
	return { q, r, terrain, icon };
}

export function parsePathFrontmatter(
	frontmatter: Record<string, unknown>,
): { hexes: HexCoord[]; type?: string; spline?: boolean } | null {
	const hexesRaw = frontmatter["path-hexes"];
	if (!Array.isArray(hexesRaw)) return null;
	const hexes: HexCoord[] = [];
	for (const pair of hexesRaw) {
		if (!Array.isArray(pair) || pair.length !== 2) continue;
		const q = Number(pair[0]);
		const r = Number(pair[1]);
		if (Number.isInteger(q) && Number.isInteger(r)) hexes.push({ q, r });
	}
	if (hexes.length < 2) return null;
	const typeRaw = frontmatter["path-type"];
	const type =
		typeof typeRaw === "string" && typeRaw.trim() ? typeRaw.trim() : undefined;
	const splineRaw = frontmatter["path-spline"];
	const spline = typeof splineRaw === "boolean" ? splineRaw : undefined;
	return { hexes, type, spline };
}
