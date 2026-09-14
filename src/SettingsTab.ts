import { App, PluginSettingTab, Setting } from "obsidian";
import type HexcrawlPlugin from "../main";
import { PaletteEditModal } from "./PaletteEditModal";
import { uniqueKey } from "./pure";

export class HexcrawlSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: HexcrawlPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Hexcrawl palettes" });
		containerEl.createEl("p", {
			text: "Reference a palette from a block with `palette: <name>`, or omit it to use the default one.",
			cls: "setting-item-description",
		});

		for (const name of Object.keys(this.plugin.settings.palettes)) {
			this.renderPaletteRow(containerEl, name);
		}

		new Setting(containerEl).addButton((btn) =>
			btn
				.setButtonText("Add palette")
				.setCta()
				.onClick(() => {
					const name = uniqueKey(this.plugin.settings.palettes, "New palette");
					this.plugin.settings.palettes[name] = { terrain: {}, paths: {} };
					void this.plugin.saveSettings();
					this.openEditor(name);
				}),
		);
	}

	private openEditor(name: string): void {
		new PaletteEditModal(this.app, this.plugin, name, () =>
			this.display(),
		).open();
	}

	private renderPaletteRow(containerEl: HTMLElement, name: string): void {
		const isDefault = this.plugin.settings.defaultPalette === name;
		const isOnly = Object.keys(this.plugin.settings.palettes).length === 1;

		const setting = new Setting(containerEl).setName(name);
		if (isDefault) setting.setDesc("Default");

		setting.addExtraButton((btn) => {
			btn
				.setIcon("star")
				.setTooltip(isDefault ? "Default palette" : "Set as default");
			btn.setDisabled(isDefault);
			btn.onClick(() => {
				this.plugin.settings.defaultPalette = name;
				void this.plugin.saveSettings();
				this.display();
			});
		});
		setting.addExtraButton((btn) =>
			btn
				.setIcon("pencil")
				.setTooltip("Edit")
				.onClick(() => this.openEditor(name)),
		);
		setting.addExtraButton((btn) =>
			btn
				.setIcon("copy")
				.setTooltip("Duplicate")
				.onClick(() => {
					const copyName = uniqueKey(
						this.plugin.settings.palettes,
						`${name} copy`,
					);
					this.plugin.settings.palettes[copyName] = JSON.parse(
						JSON.stringify(this.plugin.settings.palettes[name]),
					);
					void this.plugin.saveSettings();
					this.display();
				}),
		);
		setting.addExtraButton((btn) => {
			btn
				.setIcon("trash-2")
				.setTooltip(
					isOnly ? "At least one palette is required" : "Delete palette",
				);
			btn.setDisabled(isOnly);
			btn.onClick(() => {
				delete this.plugin.settings.palettes[name];
				if (isDefault) {
					this.plugin.settings.defaultPalette = Object.keys(
						this.plugin.settings.palettes,
					)[0];
				}
				void this.plugin.saveSettings();
				this.display();
			});
		});
	}
}
