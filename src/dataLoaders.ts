import { App, normalizePath, TFile, TFolder } from "obsidian";
import type { HexNoteData } from "./types";
import { parseHexNoteFrontmatter } from "./pure";

const ICON_EXTENSIONS = new Set(["svg", "png", "jpg", "jpeg", "gif", "webp"]);

export function loadHexNotes(app: App, folder: TFolder): Map<string, HexNoteData> {
	const notes = new Map<string, HexNoteData>();
	for (const child of folder.children) {
		if (!(child instanceof TFile) || child.extension !== "md") continue;
		const frontmatter = app.metadataCache.getFileCache(child)?.frontmatter;
		if (!frontmatter) continue;
		const parsed = parseHexNoteFrontmatter(frontmatter);
		if (!parsed) continue;
		notes.set(`${parsed.q},${parsed.r}`, {
			path: child.path,
			name: child.basename,
			terrain: parsed.terrain,
			icon: parsed.icon,
		});
	}
	return notes;
}

export function loadIconFiles(app: App, folderPath: string): Map<string, TFile> {
	const icons = new Map<string, TFile>();
	const folder = app.vault.getAbstractFileByPath(normalizePath(folderPath));
	if (!(folder instanceof TFolder)) return icons;
	for (const child of folder.children) {
		if (child instanceof TFile && ICON_EXTENSIONS.has(child.extension.toLowerCase())) {
			icons.set(child.basename, child);
		}
	}
	return icons;
}
