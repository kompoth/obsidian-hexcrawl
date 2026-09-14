import { Plugin } from "obsidian";
import { parseHexcrawlParams } from "./src/params";
import { HexMapRenderer } from "./src/HexMapRenderer";
import { resolveNamedPalette } from "./src/pure";
import { getDefaultSettings } from "./src/settings";
import type { HexcrawlSettings } from "./src/settings";
import { HexcrawlSettingTab } from "./src/SettingsTab";

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
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
