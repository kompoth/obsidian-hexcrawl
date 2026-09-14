import { App, Modal, Notice, Setting } from "obsidian";
import type HexcrawlPlugin from "../main";
import { loadIcons } from "./dataLoaders";
import { renameKey, uniqueKey } from "./pure";
import type {
	Palette,
	PathDashStyle,
	PathStyleEntry,
	TerrainPaletteEntry,
} from "./types";

const DASH_OPTIONS: PathDashStyle[] = ["solid", "dashed", "dotted"];
const DEFAULT_PATH_WIDTH = 3;

/** Edits one palette's name/icons-folder, plus a plain list of its terrain/path entries — each
 *  entry is edited in its own nested modal (TerrainEntryModal/PathEntryModal below). */
export class PaletteEditModal extends Modal {
	private pendingName: string;

	constructor(
		app: App,
		private plugin: HexcrawlPlugin,
		private name: string,
		private onDone: () => void,
	) {
		super(app);
		this.pendingName = name;
	}

	private get palette(): Palette {
		return this.plugin.settings.palettes[this.name];
	}

	onOpen(): void {
		this.setTitle("Edit palette");
		this.render();
	}

	onClose(): void {
		this.commitRename();
		this.contentEl.empty();
		this.onDone();
	}

	private commitRename(): void {
		const next = this.pendingName.trim();
		if (!next || next === this.name) return;
		if (this.plugin.settings.palettes[next]) {
			new Notice(`A palette named "${next}" already exists.`);
			return;
		}
		const wasDefault = this.plugin.settings.defaultPalette === this.name;
		renameKey(this.plugin.settings.palettes, this.name, next);
		if (wasDefault) this.plugin.settings.defaultPalette = next;
		this.name = next;
		void this.plugin.saveSettings();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		const palette = this.palette;

		new Setting(contentEl)
			.setName("Name")
			.addText((text) =>
				text.setValue(this.name).onChange((v) => (this.pendingName = v)),
			);

		new Setting(contentEl)
			.setName("Icons folder")
			.setDesc("Vault-relative folder icon names below are looked up in.")
			.addText((text) =>
				text
					.setPlaceholder("e.g. TTRPG/Icons")
					.setValue(palette.iconsFolder ?? "")
					.onChange((v) => {
						palette.iconsFolder = v.trim() || undefined;
						void this.plugin.saveSettings();
						void this.renderTerrainList(terrainListEl);
					}),
			);

		contentEl.createEl("h3", { text: "Terrain" });
		const terrainListEl = contentEl.createDiv();
		void this.renderTerrainList(terrainListEl);
		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText("Add terrain").onClick(() => {
				const key = uniqueKey(palette.terrain, "New terrain");
				palette.terrain[key] = {};
				void this.plugin.saveSettings();
				new TerrainEntryModal(
					this.app,
					this.plugin,
					this.name,
					key,
					() => void this.renderTerrainList(terrainListEl),
				).open();
			}),
		);

		contentEl.createEl("h3", { text: "Paths" });
		const pathListEl = contentEl.createDiv();
		this.renderPathList(pathListEl);
		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText("Add path type").onClick(() => {
				const key = uniqueKey(palette.paths, "New path");
				palette.paths[key] = {};
				void this.plugin.saveSettings();
				new PathEntryModal(this.app, this.plugin, this.name, key, () =>
					this.renderPathList(pathListEl),
				).open();
			}),
		);

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Done")
				.setCta()
				.onClick(() => this.close()),
		);
	}

	private async renderTerrainList(el: HTMLElement): Promise<void> {
		el.empty();
		const palette = this.palette;
		const iconSrcs = palette.iconsFolder
			? await loadIcons(this.app, palette.iconsFolder)
			: new Map<string, string>();

		for (const key of Object.keys(palette.terrain)) {
			const entry = palette.terrain[key];
			const row = new Setting(el).setName(key);
			const previewEl = row.controlEl.createDiv({
				cls: "hexcrawl-settings-preview",
			});
			previewEl.style.backgroundColor = entry.color ?? "";
			const iconSrc = entry.icon ? iconSrcs.get(entry.icon) : undefined;
			if (iconSrc) {
				const img = previewEl.createEl("img");
				img.src = iconSrc;
			}
			row.addExtraButton((btn) =>
				btn
					.setIcon("pencil")
					.setTooltip("Edit")
					.onClick(() => {
						new TerrainEntryModal(
							this.app,
							this.plugin,
							this.name,
							key,
							() => void this.renderTerrainList(el),
						).open();
					}),
			);
			row.addExtraButton((btn) =>
				btn
					.setIcon("trash-2")
					.setTooltip("Remove")
					.onClick(() => {
						delete palette.terrain[key];
						void this.plugin.saveSettings();
						void this.renderTerrainList(el);
					}),
			);
		}
	}

	private renderPathList(el: HTMLElement): void {
		el.empty();
		const palette = this.palette;

		for (const key of Object.keys(palette.paths)) {
			const entry = palette.paths[key];
			const row = new Setting(el).setName(key);
			const previewEl = row.controlEl.createDiv({
				cls: "hexcrawl-settings-path-preview",
			});
			previewEl.style.borderTopColor = entry.color ?? "var(--text-muted)";
			previewEl.style.borderTopWidth = `${Math.min(Math.max(entry.width ?? DEFAULT_PATH_WIDTH, 1), 6)}px`;
			previewEl.style.borderTopStyle =
				entry.dash === "dotted" || entry.dash === "dashed"
					? entry.dash
					: "solid";
			row.addExtraButton((btn) =>
				btn
					.setIcon("pencil")
					.setTooltip("Edit")
					.onClick(() => {
						new PathEntryModal(this.app, this.plugin, this.name, key, () =>
							this.renderPathList(el),
						).open();
					}),
			);
			row.addExtraButton((btn) =>
				btn
					.setIcon("trash-2")
					.setTooltip("Remove")
					.onClick(() => {
						delete palette.paths[key];
						void this.plugin.saveSettings();
						this.renderPathList(el);
					}),
			);
		}
	}
}

/** Shared shape for TerrainEntryModal/PathEntryModal: a nested modal editing one named entry
 *  in one of a palette's dictionaries, renaming it (with collision checks) on close. */
abstract class PaletteEntryModal<T> extends Modal {
	protected pendingKey: string;

	constructor(
		app: App,
		protected plugin: HexcrawlPlugin,
		protected paletteName: string,
		protected key: string,
		private onDone: () => void,
	) {
		super(app);
		this.pendingKey = key;
	}

	protected get palette(): Palette {
		return this.plugin.settings.palettes[this.paletteName];
	}

	/** The palette dictionary this entry lives in, e.g. `palette.terrain`. */
	protected abstract entries(palette: Palette): Record<string, T>;
	/** Singular noun for the "already exists" notice, e.g. "terrain". */
	protected abstract readonly noun: string;

	protected abstract renderFields(): void | Promise<void>;

	onOpen(): void {
		void this.renderFields();
	}

	onClose(): void {
		this.commitRename();
		this.contentEl.empty();
		this.onDone();
	}

	private commitRename(): void {
		const next = this.pendingKey.trim();
		if (!next || next === this.key) return;
		const entries = this.entries(this.palette);
		if (entries[next]) {
			new Notice(`A ${this.noun} named "${next}" already exists.`);
			return;
		}
		renameKey(entries, this.key, next);
		this.key = next;
		void this.plugin.saveSettings();
	}

	/** Delete (destructive) + Done button pair shared by both entry modals' field lists. */
	protected addDeleteDoneButtons(
		contentEl: HTMLElement,
		onDelete: () => void,
	): void {
		new Setting(contentEl)
			.addButton((btn) => {
				btn.buttonEl.addClass("mod-warning");
				btn.setButtonText("Delete").onClick(() => {
					onDelete();
					void this.plugin.saveSettings();
					this.pendingKey = this.key;
					this.close();
				});
			})
			.addButton((btn) =>
				btn
					.setButtonText("Done")
					.setCta()
					.onClick(() => this.close()),
			);
	}
}

/** Edits one terrain entry's name/color/icon, with a live preview. */
class TerrainEntryModal extends PaletteEntryModal<TerrainPaletteEntry> {
	protected noun = "terrain";

	protected entries(palette: Palette): Record<string, TerrainPaletteEntry> {
		return palette.terrain;
	}

	protected async renderFields(): Promise<void> {
		this.setTitle("Edit terrain");
		const { contentEl } = this;
		contentEl.empty();
		const palette = this.palette;
		const entry = palette.terrain[this.key];
		const iconSrcs = palette.iconsFolder
			? await loadIcons(this.app, palette.iconsFolder)
			: new Map<string, string>();

		const previewEl = contentEl.createDiv({ cls: "hexcrawl-settings-preview" });
		const updatePreview = () => {
			previewEl.empty();
			previewEl.style.backgroundColor = entry.color ?? "";
			const iconSrc = entry.icon ? iconSrcs.get(entry.icon) : undefined;
			if (iconSrc) {
				const img = previewEl.createEl("img");
				img.src = iconSrc;
			}
		};
		updatePreview();

		new Setting(contentEl)
			.setName("Name")
			.addText((text) =>
				text.setValue(this.key).onChange((v) => (this.pendingKey = v)),
			);

		new Setting(contentEl).setName("Color").addColorPicker((color) =>
			color.setValue(entry.color ?? "#888888").onChange((v) => {
				entry.color = v;
				updatePreview();
				void this.plugin.saveSettings();
			}),
		);

		new Setting(contentEl)
			.setName("Icon")
			.setDesc(
				palette.iconsFolder
					? ""
					: "Set the palette's icons folder above to pick an icon.",
			)
			.addDropdown((dropdown) => {
				dropdown.addOption("", "No icon");
				for (const iconName of [...iconSrcs.keys()].sort())
					dropdown.addOption(iconName, iconName);
				if (entry.icon && !iconSrcs.has(entry.icon)) {
					dropdown.addOption(entry.icon, `${entry.icon} (missing)`);
				}
				dropdown.setValue(entry.icon ?? "");
				dropdown.setDisabled(!palette.iconsFolder);
				dropdown.onChange((v) => {
					entry.icon = v || undefined;
					updatePreview();
					void this.plugin.saveSettings();
				});
			});

		this.addDeleteDoneButtons(
			contentEl,
			() => delete palette.terrain[this.key],
		);
	}
}

/** Edits one path type's name/color/width/dash/spline, with a live line preview. */
class PathEntryModal extends PaletteEntryModal<PathStyleEntry> {
	protected noun = "path type";

	protected entries(palette: Palette): Record<string, PathStyleEntry> {
		return palette.paths;
	}

	protected renderFields(): void {
		this.setTitle("Edit path type");
		const { contentEl } = this;
		contentEl.empty();
		const palette = this.palette;
		const entry = palette.paths[this.key];

		const previewEl = contentEl.createDiv({
			cls: "hexcrawl-settings-path-preview",
		});
		const updatePreview = () => {
			previewEl.style.borderTopColor = entry.color ?? "var(--text-muted)";
			previewEl.style.borderTopWidth = `${Math.min(Math.max(entry.width ?? DEFAULT_PATH_WIDTH, 1), 6)}px`;
			previewEl.style.borderTopStyle =
				entry.dash === "dotted" || entry.dash === "dashed"
					? entry.dash
					: "solid";
		};
		updatePreview();

		new Setting(contentEl)
			.setName("Name")
			.addText((text) =>
				text.setValue(this.key).onChange((v) => (this.pendingKey = v)),
			);

		new Setting(contentEl).setName("Color").addColorPicker((color) =>
			color.setValue(entry.color ?? "#888888").onChange((v) => {
				entry.color = v;
				updatePreview();
				void this.plugin.saveSettings();
			}),
		);

		new Setting(contentEl).setName("Width").addText((text) =>
			text
				.setPlaceholder(String(DEFAULT_PATH_WIDTH))
				.setValue(entry.width !== undefined ? String(entry.width) : "")
				.onChange((v) => {
					const width = v.trim() ? Number(v) : undefined;
					if (width !== undefined && (!Number.isFinite(width) || width <= 0))
						return;
					entry.width = width;
					updatePreview();
					void this.plugin.saveSettings();
				}),
		);

		new Setting(contentEl).setName("Dash").addDropdown((dropdown) => {
			dropdown.addOption("", "default");
			for (const opt of DASH_OPTIONS) dropdown.addOption(opt, opt);
			dropdown.setValue(entry.dash ?? "").onChange((v) => {
				entry.dash = DASH_OPTIONS.find((opt) => opt === v);
				updatePreview();
				void this.plugin.saveSettings();
			});
		});

		new Setting(contentEl)
			.setName("Spline")
			.setDesc("Render as a smooth curve instead of straight segments.")
			.addToggle((toggle) =>
				toggle.setValue(entry.spline ?? false).onChange((v) => {
					entry.spline = v;
					void this.plugin.saveSettings();
				}),
			);

		this.addDeleteDoneButtons(contentEl, () => delete palette.paths[this.key]);
	}
}
