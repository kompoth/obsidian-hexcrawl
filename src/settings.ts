import type { Palette } from "./types";

export interface HexcrawlSettings {
	/** Named palette -> definition. Always has at least one entry. */
	palettes: Record<string, Palette>;
	/** Key into `palettes` used when a block's `palette:` param is omitted. */
	defaultPalette: string;
}

export const DEFAULT_PALETTE_NAME = "Wikipedia";

// Colors lifted from Wikipedia's topographic-map hypsometric tint scale
// (Wikipedia:WikiProject_Maps/Conventions/Topographic_maps), repurposed here from
// altitude bands to biomes: greens/teal for lowland vegetation and water, tan/sand
// for arid ground, brown for high relief. River color is the guide's specified
// "rivers/coasts" blue; road/trail reuse unused bands from the same brown gradient.
const DEFAULT_PALETTE: Palette = {
	terrain: {
		plains: { color: "#D1D7AB", icon: "plains" },
		forest: { color: "#94BF8B", icon: "forest" },
		hills: { color: "#C3A76B", icon: "hills" },
		mountains: { color: "#AA8753", icon: "mountains" },
		desert: { color: "#EFEBC0", icon: "desert" },
		swamp: { color: "#A7DFD2", icon: "swamp" },
		water: { color: "#79B2DE", icon: "water" },
	},
	paths: {
		road: { color: "#B9985A", width: 3, dash: "solid" },
		river: { color: "#0978AB", width: 3, dash: "solid", spline: true },
		trail: { color: "#D3CA9D", width: 2, dash: "dashed" },
	},
};

export const DEFAULT_SETTINGS: HexcrawlSettings = {
	palettes: { [DEFAULT_PALETTE_NAME]: DEFAULT_PALETTE },
	defaultPalette: DEFAULT_PALETTE_NAME,
};
