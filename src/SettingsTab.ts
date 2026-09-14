import {
	App,
	PluginSettingTab,
	Setting,
	type SettingDefinitionItem,
} from "obsidian";
import type HexcrawlPlugin from "../main";
import { PaletteEditModal } from "./PaletteEditModal";
import { uniqueKey } from "./pure";
import type { Palette } from "./types";

const PALETTES_DESCRIPTION =
	"Reference a palette from a block with `palette: <name>`, or omit it to use the default one.";

export class HexcrawlSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: HexcrawlPlugin,
	) {
		super(app, plugin);
	}

	// Fallback for Obsidian < 1.13.0, which doesn't support getSettingDefinitions().
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl).setName("Palettes").setHeading();
		containerEl.createEl("p", {
			text: PALETTES_DESCRIPTION,
			cls: "setting-item-description",
		});

		for (const name of Object.keys(this.plugin.settings.palettes)) {
			this.renderPaletteRow(new Setting(containerEl), name);
		}

		new Setting(containerEl).addButton((btn) =>
			btn
				.setButtonText("Add palette")
				.setCta()
				.onClick(() => this.addPalette()),
		);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: "group",
				heading: "Palettes",
				items: [{ name: "", desc: PALETTES_DESCRIPTION }],
			},
			{
				type: "list",
				items: Object.keys(this.plugin.settings.palettes).map((name) => ({
					name,
					render: (setting: Setting) => this.renderPaletteRow(setting, name),
				})),
				addItem: {
					name: "Add palette",
					action: () => this.addPalette(),
				},
			},
		];
	}

	private addPalette(): void {
		const name = uniqueKey(this.plugin.settings.palettes, "New palette");
		this.plugin.settings.palettes[name] = { terrain: {}, paths: {} };
		void this.plugin.saveSettings();
		this.openEditor(name);
	}

	// Re-renders the tab regardless of which of display()/getSettingDefinitions()
	// the running Obsidian version rendered from.
	private refresh(): void {
		if (typeof this.update === "function") {
			this.update();
		} else {
			this.display();
		}
	}

	private openEditor(name: string): void {
		new PaletteEditModal(this.app, this.plugin, name, () =>
			this.refresh(),
		).open();
	}

	private renderPaletteRow(setting: Setting, name: string): void {
		const isDefault = this.plugin.settings.defaultPalette === name;
		const isOnly = Object.keys(this.plugin.settings.palettes).length === 1;

		setting.setName(name);
		if (isDefault) setting.setDesc("Default");

		setting.addExtraButton((btn) => {
			btn
				.setIcon("star")
				.setTooltip(isDefault ? "Default palette" : "Set as default");
			btn.setDisabled(isDefault);
			btn.onClick(() => {
				this.plugin.settings.defaultPalette = name;
				void this.plugin.saveSettings();
				this.refresh();
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
					) as Palette;
					void this.plugin.saveSettings();
					this.refresh();
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
				this.refresh();
			});
		});
	}
}
