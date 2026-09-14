import castle from "../icons/castle.svg";
import city from "../icons/city.svg";
import desert from "../icons/desert.svg";
import fields from "../icons/fields.svg";
import forestHill from "../icons/forest-hill.svg";
import forestMountain from "../icons/forest-mountain.svg";
import forestMountains from "../icons/forest-mountains.svg";
import forest from "../icons/forest.svg";
import grass from "../icons/grass.svg";
import hill from "../icons/hill.svg";
import keep from "../icons/keep.svg";
import lake from "../icons/lake.svg";
import largeTown from "../icons/large-town.svg";
import marsh from "../icons/marsh.svg";
import mountain from "../icons/mountain.svg";
import mountains from "../icons/mountains.svg";
import shrine from "../icons/shrine.svg";
import swamp from "../icons/swamp.svg";
import swamp2 from "../icons/swamp2.svg";
import thorp from "../icons/thorp.svg";
import tower from "../icons/tower.svg";
import town from "../icons/town.svg";
import village from "../icons/village.svg";

/**
 * The plugin's own icon pack (Gnomeyland, see README), inlined as data URIs at build time
 * (esbuild.config.mjs's `.svg` -> "dataurl" loader) so it ships inside main.js instead of
 * needing an `icons/` folder to exist on disk — installs via Community Plugins/BRAT only
 * ever fetch main.js/manifest.json/styles.css, never arbitrary extra files.
 */
export const BUNDLED_ICONS: Map<string, string> = new Map([
	["castle", castle],
	["city", city],
	["desert", desert],
	["fields", fields],
	["forest-hill", forestHill],
	["forest-mountain", forestMountain],
	["forest-mountains", forestMountains],
	["forest", forest],
	["grass", grass],
	["hill", hill],
	["keep", keep],
	["lake", lake],
	["large-town", largeTown],
	["marsh", marsh],
	["mountain", mountain],
	["mountains", mountains],
	["shrine", shrine],
	["swamp", swamp],
	["swamp2", swamp2],
	["thorp", thorp],
	["tower", tower],
	["town", town],
	["village", village],
]);
