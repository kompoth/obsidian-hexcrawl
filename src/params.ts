import { parseYaml } from "obsidian";
import type {
	HexcrawlBlockParams,
	HexOrientation,
	Palette,
	PathDashStyle,
	StaggerOffset,
} from "./types";

const DASH_STYLES: PathDashStyle[] = ["solid", "dashed", "dotted"];

export type ParamsResult =
	{ ok: true; value: HexcrawlBlockParams } | { ok: false; error: string };

const DEFAULT_HEX_SIZE = 40;
const DEFAULT_HEIGHT = 500;

export function parseHexcrawlParams(
	source: string,
	resolveNamedPalette: (name: string | undefined) => Palette | undefined,
): ParamsResult {
	let raw: unknown;
	try {
		raw = parseYaml(source);
	} catch (e) {
		return {
			ok: false,
			error: `Could not parse parameters: ${(e as Error).message}`,
		};
	}
	if (raw === null || raw === undefined || typeof raw !== "object") {
		return {
			ok: false,
			error: "Expected key: value parameters, e.g. `folder: Hexes`.",
		};
	}
	const params = raw as Record<string, unknown>;

	const folder = typeof params.folder === "string" ? params.folder.trim() : "";
	if (!folder) {
		return { ok: false, error: "Missing required parameter: folder" };
	}

	const orientationRaw =
		typeof params.orientation === "string"
			? params.orientation.toLowerCase()
			: "pointy";
	if (orientationRaw !== "pointy" && orientationRaw !== "flat") {
		return {
			ok: false,
			error: `Invalid orientation "${String(params.orientation)}" — expected "pointy" or "flat".`,
		};
	}
	const orientation = orientationRaw as HexOrientation;

	const staggerRaw =
		typeof params.stagger === "string" ? params.stagger.toLowerCase() : "odd";
	if (staggerRaw !== "odd" && staggerRaw !== "even") {
		return {
			ok: false,
			error: `Invalid stagger "${String(params.stagger)}" — expected "odd" or "even".`,
		};
	}
	const stagger = staggerRaw as StaggerOffset;

	const cols = Number(params.cols);
	if (!Number.isInteger(cols) || cols <= 0) {
		return {
			ok: false,
			error: "Missing/invalid required parameter: cols (positive integer)",
		};
	}

	const rows = Number(params.rows);
	if (!Number.isInteger(rows) || rows <= 0) {
		return {
			ok: false,
			error: "Missing/invalid required parameter: rows (positive integer)",
		};
	}

	const hexSize =
		params.hexSize !== undefined ? Number(params.hexSize) : DEFAULT_HEX_SIZE;
	if (!Number.isFinite(hexSize) || hexSize <= 0) {
		return { ok: false, error: "Invalid hexSize — must be a positive number." };
	}

	const height =
		params.height !== undefined ? Number(params.height) : DEFAULT_HEIGHT;
	if (!Number.isFinite(height) || height <= 0) {
		return { ok: false, error: "Invalid height — must be a positive number." };
	}

	const showCoords =
		params.coords === undefined ? false : Boolean(params.coords);

	const pathsFolder =
		typeof params.paths === "string" && params.paths.trim()
			? params.paths.trim()
			: undefined;

	const paletteResult = parsePalette(params.palette, resolveNamedPalette);
	if (!paletteResult.ok) return paletteResult;

	return {
		ok: true,
		value: {
			folder,
			orientation,
			stagger,
			cols,
			rows,
			hexSize,
			height,
			showCoords,
			palette: paletteResult.value,
			pathsFolder,
		},
	};
}

function parsePalette(
	raw: unknown,
	resolveNamedPalette: (name: string | undefined) => Palette | undefined,
): { ok: true; value: Palette | undefined } | { ok: false; error: string } {
	if (raw === undefined) {
		// No palette named or configured yet (e.g. settings has none) is not an error —
		// downstream just treats the block as palette-less, same as always.
		return { ok: true, value: resolveNamedPalette(undefined) };
	}
	if (typeof raw === "string") {
		const name = raw.trim();
		const resolved = resolveNamedPalette(name || undefined);
		if (!resolved) {
			return {
				ok: false,
				error: `Unknown palette "${name}" — check it exists in Hexcrawl plugin settings.`,
			};
		}
		return { ok: true, value: resolved };
	}
	if (typeof raw !== "object" || raw === null) {
		return {
			ok: false,
			error:
				"palette must be a palette name (string) or an inline mapping, e.g. `palette:\\n  terrain:\\n    forest: ...`",
		};
	}
	const paletteRaw = raw as Record<string, unknown>;

	const paletteIconsFolder =
		typeof paletteRaw.icons === "string" && paletteRaw.icons.trim()
			? paletteRaw.icons.trim()
			: undefined;

	const terrain: Palette["terrain"] = {};
	if (paletteRaw.terrain !== undefined) {
		if (typeof paletteRaw.terrain !== "object" || paletteRaw.terrain === null) {
			return {
				ok: false,
				error:
					"palette.terrain must be a mapping of terrain name to {color, icon}.",
			};
		}
		for (const [name, entryRaw] of Object.entries(
			paletteRaw.terrain as Record<string, unknown>,
		)) {
			if (typeof entryRaw !== "object" || entryRaw === null) {
				return {
					ok: false,
					error: `palette.terrain.${name} must be a mapping with color/icon.`,
				};
			}
			const entry = entryRaw as Record<string, unknown>;
			const color =
				typeof entry.color === "string" && entry.color.trim()
					? entry.color.trim()
					: undefined;
			const icon =
				typeof entry.icon === "string" && entry.icon.trim()
					? entry.icon.trim()
					: undefined;
			terrain[name] = { color, icon };
		}
	}

	const paths: Palette["paths"] = {};
	if (paletteRaw.paths !== undefined) {
		if (typeof paletteRaw.paths !== "object" || paletteRaw.paths === null) {
			return {
				ok: false,
				error:
					"palette.paths must be a mapping of path type to {color, width, dash, spline}.",
			};
		}
		for (const [name, entryRaw] of Object.entries(
			paletteRaw.paths as Record<string, unknown>,
		)) {
			if (typeof entryRaw !== "object" || entryRaw === null) {
				return {
					ok: false,
					error: `palette.paths.${name} must be a mapping with color/width/dash/spline.`,
				};
			}
			const entry = entryRaw as Record<string, unknown>;
			const color =
				typeof entry.color === "string" && entry.color.trim()
					? entry.color.trim()
					: undefined;

			const width = entry.width !== undefined ? Number(entry.width) : undefined;
			if (width !== undefined && (!Number.isFinite(width) || width <= 0)) {
				return {
					ok: false,
					error: `palette.paths.${name}.width must be a positive number.`,
				};
			}

			let dash: PathDashStyle | undefined;
			if (entry.dash !== undefined) {
				const dashRaw =
					typeof entry.dash === "string" ? entry.dash.toLowerCase() : "";
				if (!DASH_STYLES.includes(dashRaw as PathDashStyle)) {
					return {
						ok: false,
						error: `palette.paths.${name}.dash must be one of: ${DASH_STYLES.join(", ")}.`,
					};
				}
				dash = dashRaw as PathDashStyle;
			}

			const spline =
				entry.spline === undefined ? undefined : Boolean(entry.spline);

			paths[name] = { color, width, dash, spline };
		}
	}

	return {
		ok: true,
		value: { terrain, paths, iconsFolder: paletteIconsFolder },
	};
}
