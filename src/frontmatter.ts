import type { HexCoord } from "./types";

export function parseHexNoteFrontmatter(frontmatter: Record<string, unknown>): {
	q: number;
	r: number;
	terrain?: string;
	icon?: string;
	gmIcon?: string;
} | null {
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
	const gmIconRaw = frontmatter["hex-gm-icon"];
	const gmIcon =
		typeof gmIconRaw === "string" && gmIconRaw.trim()
			? gmIconRaw.trim()
			: undefined;
	return { q, r, terrain, icon, gmIcon };
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

export type BorderFrontmatterResult =
	| { ok: true; type?: string; pairs: [HexCoord, HexCoord][] }
	| { ok: false; error: string };

/**
 * Structural parsing only (no adjacency/direction checks — those need orientation/stagger and
 * live in borderGeometry.ts's validateBorderPairs, called by the loader/tool). Unlike
 * parsePathFrontmatter's per-entry filtering, any single malformed pair fails the whole note:
 * the spec requires border errors to be shown/logged, not silently dropped.
 */
export function parseBorderFrontmatter(
	frontmatter: Record<string, unknown>,
): BorderFrontmatterResult {
	const hexesRaw = frontmatter["border-hexes"];
	if (!Array.isArray(hexesRaw) || hexesRaw.length === 0) {
		return {
			ok: false,
			error: "border-hexes must be a non-empty array of hex pairs",
		};
	}

	const toHex = (raw: unknown): HexCoord | null => {
		if (!Array.isArray(raw) || raw.length !== 2) return null;
		const q = Number(raw[0]);
		const r = Number(raw[1]);
		return Number.isInteger(q) && Number.isInteger(r) ? { q, r } : null;
	};

	const pairs: [HexCoord, HexCoord][] = [];
	for (let i = 0; i < hexesRaw.length; i++) {
		const pairRaw: unknown = hexesRaw[i];
		if (!Array.isArray(pairRaw) || pairRaw.length !== 2) {
			return {
				ok: false,
				error: `border-hexes[${i}] must be a pair of hex coordinates`,
			};
		}
		const a = toHex(pairRaw[0]);
		const b = toHex(pairRaw[1]);
		if (!a || !b) {
			return {
				ok: false,
				error: `border-hexes[${i}] has an invalid hex coordinate`,
			};
		}
		pairs.push([a, b]);
	}

	const typeRaw = frontmatter["border-type"];
	const type =
		typeof typeRaw === "string" && typeRaw.trim() ? typeRaw.trim() : undefined;
	return { ok: true, type, pairs };
}
