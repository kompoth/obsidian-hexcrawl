import { Plugin } from "obsidian";
import { parseHexcrawlParams } from "./src/params";
import { HexMapRenderer } from "./src/render/HexMapRenderer";
import { resolveNamedPalette } from "./src/palette";
import { getDefaultSettings } from "./src/settings/settings";
import type { HexcrawlSettings } from "./src/settings/settings";
import { HexcrawlSettingTab } from "./src/settings/SettingsTab";

export default class HexcrawlPlugin extends Plugin {
	settings: HexcrawlSettings;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new HexcrawlSettingTab(this.app, this));

		this.registerMarkdownCodeBlockProcessor("hexcrawl", (source, el, ctx) => {
			const result = parseHexcrawlParams(source, (name) =>
				resolveNamedPalette(name, this.settings),
			);
			if (!result.ok) {
				el.createEl("pre", { text: `hexcrawl: ${result.error}` });
				return;
			}
			new HexMapRenderer(this.app, el, result.value, ctx).render();
		});
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<HexcrawlSettings> | null;
		this.settings = Object.assign({}, getDefaultSettings(), data);
		// Settings saved before the Borders feature existed have no `borders` key on their
		// palettes — backfill it so every other reader can assume it's always present.
		for (const palette of Object.values(this.settings.palettes)) {
			palette.borders ??= {};
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
