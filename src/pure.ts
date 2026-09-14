/**
 * Plain validation/formatting helpers used by dataLoaders.ts and PathTool.ts, kept in their
 * own Obsidian-free module (only "./types" is imported) so they're unit-testable without
 * mocking the Obsidian API — that module has no runtime build, only type declarations.
 */
import type {
	HexCoord,
	HexNoteData,
	Palette,
	PathDashStyle,
	TerrainPaletteEntry,
} from "./types";

/** The palette entry for a hex note's terrain, if any — shared by the terrain and icon layers. */
export function resolvePaletteEntry(
	note: HexNoteData | undefined,
	palette: Palette | undefined,
): TerrainPaletteEntry | undefined {
	return note?.terrain ? palette?.terrain[note.terrain] : undefined;
}

/** A hex's terrain color: the palette's for its hex-terrain, else the literal hex-terrain value. */
export function resolveHexColor(
	note: HexNoteData | undefined,
	palette: Palette | undefined,
): string {
	return resolvePaletteEntry(note, palette)?.color ?? note?.terrain ?? "";
}

/** A hex's icon name: its own hex-icon override, else the palette's for its hex-terrain. */
export function resolveIconName(
	note: HexNoteData | undefined,
	palette: Palette | undefined,
): string | undefined {
	return note?.icon ?? resolvePaletteEntry(note, palette)?.icon;
}

/** Looks up a global palette by name, falling back to the settings' default when `name` is undefined. */
export function resolveNamedPalette(
	name: string | undefined,
	settings: { palettes: Record<string, Palette>; defaultPalette: string },
): Palette | undefined {
	return settings.palettes[name ?? settings.defaultPalette];
}

/** Icon names (terrain/hex-icon) are looked up in the active palette's own icons folder. */
export function resolveIconsFolder(params: {
	palette?: Palette;
}): string | undefined {
	return params.palette?.iconsFolder;
}

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

/** stroke-dasharray for a dash style, scaled to the line's width. */
export function dashArray(dash: PathDashStyle, width: number): string {
	if (dash === "dotted") return `${width * 0.4} ${width * 1.8}`;
	if (dash === "dashed") return `${width * 2.5} ${width * 1.8}`;
	return "none";
}

/** Sanitizes a name into a free filename, appending " 2", " 3", ... on collision per `exists`. */
export function uniqueFileName(
	name: string,
	exists: (candidate: string) => boolean,
): string {
	const safe = name.replace(/[\\/:*?"<>|]/g, "-").trim() || "Path";
	let candidate = safe;
	let n = 2;
	while (exists(candidate)) candidate = `${safe} ${n++}`;
	return candidate;
}

/** Renames a Record's key in place, preserving the insertion order of the other entries. */
export function renameKey<T>(
	record: Record<string, T>,
	from: string,
	to: string,
): void {
	const renamed: Record<string, T> = {};
	for (const [key, value] of Object.entries(record)) {
		renamed[key === from ? to : key] = value;
	}
	for (const key of Object.keys(record)) delete record[key];
	Object.assign(record, renamed);
}

/** First free key: `base` itself, or `"${base} 2"`, `"${base} 3"`, ... on collision. */
export function uniqueKey(
	record: Record<string, unknown>,
	base: string,
): string {
	if (!(base in record)) return base;
	let n = 2;
	while (`${base} ${n}` in record) n++;
	return `${base} ${n}`;
}
