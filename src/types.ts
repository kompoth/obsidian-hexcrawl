import type { TFile } from "obsidian";

export type HexOrientation = "pointy" | "flat";

/** Which parity of row (pointy-top) or column (flat-top) is the shifted one. */
export type StaggerOffset = "odd" | "even";

/** How hex-gm-icon is rendered: at hex center like a regular icon, or small in a corner. */
export type GmIconMode = "default" | "mini";

export interface TerrainPaletteEntry {
	color?: string;
	/** Icon file basename (without extension), looked up in the block's icons folder. */
	icon?: string;
}

export type PathDashStyle = "solid" | "dashed" | "dotted";

export interface PathStyleEntry {
	color?: string;
	/** Stroke width in pixels. */
	width?: number;
	dash?: PathDashStyle;
	/** Default rendering method for paths of this type; a note's own path-spline overrides it. */
	spline?: boolean;
}

export interface BorderStyleEntry {
	color?: string;
	/** Stroke width in pixels. */
	width?: number;
	dash?: PathDashStyle;
	/** Pixels the edge is shifted toward the first hex of each pair (the pivot it's defined
	 *  from) — 0 (or undefined) means no shift. */
	edgeOffset?: number;
}

export interface Palette {
	/** Terrain name (matched against a note's hex-terrain value) -> entry. */
	terrain: Record<string, TerrainPaletteEntry>;
	/** Path type (matched against a note's path-type value) -> style. */
	paths: Record<string, PathStyleEntry>;
	/** Border type (matched against a note's border-type value) -> style. */
	borders: Record<string, BorderStyleEntry>;
	/** Vault-relative folder icon names (terrain/hex-icon) are looked up in. */
	iconsFolder?: string;
}

export interface HexcrawlBlockParams {
	/** Vault-relative path to the folder containing hex notes. */
	folder: string;
	orientation: HexOrientation;
	stagger: StaggerOffset;
	/** Hex radius (center to vertex) in pixels. */
	hexSize: number;
	cols: number;
	rows: number;
	/** Visible map panel height in pixels. */
	height: number;
	/** Show q/r coordinate labels along the top and left axes. */
	showCoords: boolean;
	/** Vault-relative path to the folder containing path notes (roads, rivers, barriers, ...). */
	pathsFolder?: string;
	/** Vault-relative path to the folder containing border notes. */
	bordersFolder?: string;
	palette?: Palette;
	/** How hex-gm-icon is rendered on its own visibility layer, above everything else. */
	gmIconMode: GmIconMode;
}

export interface HexNoteData {
	/** The note's own TFile — Obsidian mutates this in place on rename/move, so operations
	 *  against it stay correct without needing to re-resolve a cached path string. */
	file: TFile;
	name: string;
	terrain?: string;
	/** hex-icon frontmatter value; overrides whatever icon the palette would pick for hex-terrain. */
	icon?: string;
	/** hex-gm-icon frontmatter value, rendered on the GM-only icon layer. */
	gmIcon?: string;
}

export interface HexCoord {
	q: number;
	r: number;
}

export interface PathData {
	/** The note this path came from, so clicking it can open that note — a live TFile rather
	 *  than a path string, so it stays valid across an external rename/move. */
	file: TFile;
	name: string;
	/** path-type frontmatter value, e.g. "road" | "river" | "barrier". Looked up in palette.paths; also used as a CSS class modifier and, if unmatched, as a literal CSS color (same fallback as hex-terrain). */
	type?: string;
	/** Ordered hex centers the path runs through, from path-hexes. */
	hexes: HexCoord[];
	/** Render as a smooth spline instead of straight segments; undefined defers to the palette's default for this type. */
	spline?: boolean;
}

export interface BorderData {
	/** The note this border came from, so clicking it can open that note — a live TFile rather
	 *  than a path string, so it stays valid across an external rename/move. */
	file: TFile;
	name: string;
	/** border-type frontmatter value; looked up in palette.borders the same way path-type is. */
	type?: string;
	/** Head-to-tail pairs of neighboring hexes from border-hexes; each pair's shared edge is one segment. */
	pairs: [HexCoord, HexCoord][];
}
