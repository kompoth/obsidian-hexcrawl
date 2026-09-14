import { App, normalizePath, TFile, TFolder } from "obsidian";
import type { HexNoteData } from "./types";
import { hexKey } from "./hexGeometry";
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
 * outside the indexed vault tree, e.g. a plugin's own bundled `.obsidian/plugins/<id>/icons`.
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
	for (const path of listed.files) {
		const filename = path.slice(path.lastIndexOf("/") + 1);
		const dot = filename.lastIndexOf(".");
		if (dot <= 0) continue;
		const basename = filename.slice(0, dot);
		const extension = filename.slice(dot + 1).toLowerCase();
		if (!ICON_EXTENSIONS.has(extension)) continue;

		// getResourcePath() alone returns a bare, stable URL for an adapter path (unlike the
		// TFile overload, which appends the file's mtime itself) — append it here so editing an
		// icon's contents on disk actually busts the browser's cache for its `<img src>`.
		const stat = await app.vault.adapter.stat(path);
		const resourcePath = app.vault.adapter.getResourcePath(path);
		const src = stat
			? `${resourcePath}${resourcePath.includes("?") ? "&" : "?"}hexcrawl-mtime=${stat.mtime}`
			: resourcePath;
		icons.set(basename, src);
	}
	return icons;
}
