import type { Palette } from "./types";

export interface HexcrawlSettings {
	/** Named palette -> definition. Always has at least one entry. */
	palettes: Record<string, Palette>;
	/** Key into `palettes` used when a block's `palette:` param is omitted. */
	defaultPalette: string;
}

export const DEFAULT_PALETTE_NAME = "Text Mapper";

/** `iconsFolder` for the bundled palette below — the plugin's own installed `icons/` folder,
 *  passed in by main.ts since it depends on where this install of the plugin actually lives. */
export function getDefaultSettings(
	builtinIconsFolder: string | undefined,
): HexcrawlSettings {
	// Terrain/path colors are the named fills from the Text Mapper/Gnomeyland DSL itself
	// (campaignwiki.org/text-mapper's gnomeyland.txt) rather than invented hex values —
	// picked per its own "suitable for X" grouping comments.
	const defaultPalette: Palette = {
		terrain: {
			plains: { color: "#B0B446", icon: "grass" }, // soil
			forest: { color: "#77904C", icon: "forest" }, // green
			hills: { color: "#EBE785", icon: "hill" }, // dust
			mountains: { color: "#ACBC9D", icon: "mountains" }, // gray
			desert: { color: "#E3BEA3", icon: "desert" }, // sand
			swamp: { color: "#6F9487", icon: "swamp" }, // blue-green
			water: { color: "#6EBAE7", icon: "lake" }, // water
		},
		paths: {
			road: { color: "#C97457", width: 5, dash: "solid" }, // dark-soil
			river: { color: "#6EBAE7", width: 5, dash: "solid", spline: true },
			trail: { color: "#000000", width: 3, dash: "dashed" },
			seaway: { color: "#ffffff", width: 3, dash: "dashed", spline: true },
		},
		iconsFolder: builtinIconsFolder,
	};
	return {
		palettes: { [DEFAULT_PALETTE_NAME]: defaultPalette },
		defaultPalette: DEFAULT_PALETTE_NAME,
	};
}
