import type { HexNoteData, Palette, TerrainPaletteEntry } from "./types";

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

/** A hex's GM-only icon name: its own hex-gm-icon value, with no palette-driven fallback. */
export function resolveGmIconName(
	note: HexNoteData | undefined,
): string | undefined {
	return note?.gmIcon;
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
