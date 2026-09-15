import { App, normalizePath, TFile, TFolder } from "obsidian";
import type { HexNoteData } from "./types";
import { BUNDLED_ICONS } from "./bundledIcons";
import { hexKey } from "./render/hexGeometry";
import { parseHexNoteFrontmatter } from "./pure";

const ICON_EXTENSIONS = new Set(["svg", "png", "jpg", "jpeg", "gif", "webp"]);

export function loadHexNotes(
	app: App,
	folder: TFolder,
): Map<string, HexNoteData> {
	const notes = new Map<string, HexNoteData>();
	for (const child of folder.children) {
		if (!(child instanceof TFile) || child.extension !== "md") continue;
		const frontmatter = app.metadataCache.getFileCache(child)?.frontmatter;
		if (!frontmatter) continue;
		const parsed = parseHexNoteFrontmatter(frontmatter);
		if (!parsed) continue;
		notes.set(hexKey(parsed.q, parsed.r), {
			path: child.path,
			name: child.basename,
			terrain: parsed.terrain,
			icon: parsed.icon,
		});
	}
	return notes;
}

/**
 * Icon name -> resolved `<img src>` URL, for a vault-relative folder. Goes through
 * `app.vault.adapter` rather than the `TFile` vault index so this also works for folders
 * outside the indexed vault tree.
 */
export async function loadIcons(
	app: App,
	folderPath: string,
): Promise<Map<string, string>> {
	const icons = new Map<string, string>();
	const normalized = normalizePath(folderPath);
	let listed;
	try {
		listed = await app.vault.adapter.list(normalized);
	} catch {
		return icons;
	}
	const iconFiles = listed.files.flatMap((path) => {
		const filename = path.slice(path.lastIndexOf("/") + 1);
		const dot = filename.lastIndexOf(".");
		if (dot <= 0) return [];
		const basename = filename.slice(0, dot);
		const extension = filename.slice(dot + 1).toLowerCase();
		return ICON_EXTENSIONS.has(extension) ? [{ path, basename }] : [];
	});

	await Promise.all(
		iconFiles.map(async ({ path, basename }) => {
			// getResourcePath() alone returns a bare, stable URL for an adapter path (unlike the
			// TFile overload, which appends the file's mtime itself) — append it here so editing an
			// icon's contents on disk actually busts the browser's cache for its `<img src>`.
			const stat = await app.vault.adapter.stat(path);
			const resourcePath = app.vault.adapter.getResourcePath(path);
			const src = stat
				? `${resourcePath}${resourcePath.includes("?") ? "&" : "?"}hexcrawl-mtime=${stat.mtime}`
				: resourcePath;
			icons.set(basename, src);
		}),
	);
	return icons;
}

/**
 * A palette's effective icon set: the plugin's own bundled pack when no `iconsFolder` is
 * configured, or *only* that folder's icons when one is — the two are never mixed, so
 * setting a folder is an explicit opt-out of the bundled pack rather than an addition to it.
 */
export async function resolveIcons(
	app: App,
	iconsFolder: string | undefined,
): Promise<Map<string, string>> {
	return iconsFolder ? loadIcons(app, iconsFolder) : BUNDLED_ICONS;
}
