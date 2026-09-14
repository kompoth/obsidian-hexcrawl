import { App } from "obsidian";
import type { HexcrawlBlockParams, HexNoteData } from "./types";
import { hexCenter, hexKey, hexSize } from "./hexGeometry";
import { loadIcons } from "./dataLoaders";
import { resolvePaletteEntry } from "./pure";

const ICON_SCALE = 0.9;

/** Hex icons — from the terrain palette's default, or a hex's own hex-icon override. */
export class IconsLayer {
	private el: HTMLElement | null = null;
	private iconElements = new Map<string, HTMLImageElement>();
	private iconSrcs: Map<string, string> | undefined;
	private gutter = 0;
	private visible = true;

	constructor(
		private app: App,
		private params: HexcrawlBlockParams,
	) {}

	async load(iconsFolder: string | undefined): Promise<void> {
		this.iconSrcs = iconsFolder
			? await loadIcons(this.app, iconsFolder)
			: undefined;
	}

	/**
	 * `totalSize` must be set explicitly: this layer's own children are all `position: absolute`,
	 * so without a declared size it collapses to shrink-to-fit-of-nothing (0×0) — which some themes'
	 * global `img { max-width: 100% }` rules then clamp every icon `<img>` down to (0% of 0).
	 */
	mount(
		viewportEl: HTMLElement,
		totalSize: { width: number; height: number },
	): void {
		this.el = viewportEl.createDiv({
			cls: ["hexcrawl-layer", "hexcrawl-layer-icons"],
		});
		this.el.style.width = `${totalSize.width}px`;
		this.el.style.height = `${totalSize.height}px`;
		this.el.style.display = this.visible ? "" : "none";
	}

	setVisible(visible: boolean): void {
		this.visible = visible;
		if (this.el) this.el.style.display = visible ? "" : "none";
	}

	get isVisible(): boolean {
		return this.visible;
	}

	render(hexNotes: Map<string, HexNoteData>, gutter: number): void {
		const el = this.el;
		if (!el) return;
		this.gutter = gutter;
		const {
			orientation,
			stagger,
			hexSize: radius,
			cols,
			rows,
			palette,
		} = this.params;
		const { w: hexW, h: hexH } = hexSize(radius, orientation);

		for (let r = 0; r < rows; r++) {
			for (let q = 0; q < cols; q++) {
				const key = hexKey(q, r);
				const note = hexNotes.get(key);
				const iconName = note?.icon ?? resolvePaletteEntry(note, palette)?.icon;
				if (!iconName) continue;
				const iconSrc = this.iconSrcs?.get(iconName);
				if (!iconSrc) continue;
				const center = hexCenter(q, r, orientation, radius, stagger);
				this.placeIcon(
					el,
					key,
					iconSrc,
					iconName,
					gutter + center.cx,
					gutter + center.cy,
					hexW,
					hexH,
				);
			}
		}
	}

	/** Re-derives one hex's icon (add/update/remove) from its current note data. */
	updateHex(q: number, r: number, note: HexNoteData): void {
		const el = this.el;
		if (!el) return;
		const key = hexKey(q, r);
		const { orientation, stagger, hexSize: radius, palette } = this.params;
		const iconName = note.icon ?? resolvePaletteEntry(note, palette)?.icon;
		const iconSrc = iconName ? this.iconSrcs?.get(iconName) : undefined;
		const iconEl = this.iconElements.get(key);

		if (iconName && iconSrc) {
			const center = hexCenter(q, r, orientation, radius, stagger);
			const { w: hexW, h: hexH } = hexSize(radius, orientation);
			this.placeIcon(
				el,
				key,
				iconSrc,
				iconName,
				this.gutter + center.cx,
				this.gutter + center.cy,
				hexW,
				hexH,
			);
		} else if (iconEl) {
			iconEl.remove();
			this.iconElements.delete(key);
		}
	}

	private placeIcon(
		container: HTMLElement,
		key: string,
		src: string,
		alt: string,
		cx: number,
		cy: number,
		hexW: number,
		hexH: number,
	): void {
		const iconW = hexW * ICON_SCALE;
		const iconH = hexH * ICON_SCALE;
		let iconEl = this.iconElements.get(key);

		if (!iconEl) {
			iconEl = container.createEl("img", { cls: "hexcrawl-hex-icon" });
			iconEl.draggable = false;
			iconEl.tabIndex = -1;
			iconEl.addEventListener("dragstart", (e) => e.preventDefault());
			iconEl.style.width = `${iconW}px`;
			iconEl.style.height = `${iconH}px`;
			iconEl.style.left = `${cx - iconW / 2}px`;
			iconEl.style.top = `${cy - iconH / 2}px`;
			this.iconElements.set(key, iconEl);
		}
		iconEl.src = src;
		iconEl.alt = alt;
	}
}
