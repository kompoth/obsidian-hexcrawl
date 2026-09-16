import { App } from "obsidian";
import type { HexcrawlBlockParams, HexNoteData } from "../types";
import { hexCenter, hexKey, hexSize } from "./hexGeometry";
import { resolveIcons } from "../dataLoaders";
import { resolveIconsFolder, resolveGmIconName } from "../palette";

const ICON_SCALE = 0.9;
/** "mini" mode renders the icon at half the size used by "default" mode. */
const MINI_SCALE = 0.5;

/**
 * hex-gm-icon — a GM-only icon layer, rendered above everything else (terrain, paths, icons).
 * Looks up icon names in the same icon set as the regular icon layer, but with no palette
 * fallback: a hex only shows a GM icon if its note sets hex-gm-icon directly.
 */
export class GmIconsLayer {
	private el: HTMLElement | null = null;
	private iconElements = new Map<string, HTMLImageElement>();
	private iconSrcs: Map<string, string> = new Map();
	private gutter = 0;
	private visible = true;

	constructor(
		private app: App,
		private params: HexcrawlBlockParams,
	) {}

	async load(): Promise<void> {
		this.iconSrcs = await resolveIcons(
			this.app,
			resolveIconsFolder(this.params),
		);
	}

	/** See IconsLayer.mount for why `totalSize` must be set explicitly. */
	mount(
		viewportEl: HTMLElement,
		totalSize: { width: number; height: number },
	): void {
		this.el = viewportEl.createDiv({
			cls: ["hexcrawl-layer", "hexcrawl-layer-gm-icons"],
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
		const { orientation, stagger, hexSize: radius, cols, rows } = this.params;
		const { w: hexW, h: hexH } = hexSize(radius, orientation);

		for (let r = 0; r < rows; r++) {
			for (let q = 0; q < cols; q++) {
				const key = hexKey(q, r);
				const note = hexNotes.get(key);
				const iconName = resolveGmIconName(note);
				if (!iconName) continue;
				const iconSrc = this.iconSrcs.get(iconName);
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

	/** Re-derives one hex's GM icon (add/update/remove) from its current note data. */
	updateHex(q: number, r: number, note: HexNoteData | undefined): void {
		const el = this.el;
		if (!el) return;
		const key = hexKey(q, r);
		const { orientation, stagger, hexSize: radius } = this.params;
		const iconName = resolveGmIconName(note);
		const iconSrc = iconName ? this.iconSrcs.get(iconName) : undefined;
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

	/**
	 * "default" mode places the icon at hex center like a regular icon; "mini" mode shrinks it
	 * to half that size and shifts its center toward the hex's top-left sector.
	 */
	private layout(
		cx: number,
		cy: number,
		hexW: number,
		hexH: number,
	): { iconW: number; iconH: number; left: number; top: number } {
		const iconW = hexW * ICON_SCALE;
		const iconH = hexH * ICON_SCALE;
		if (this.params.gmIconMode !== "mini") {
			return { iconW, iconH, left: cx - iconW / 2, top: cy - iconH / 2 };
		}
		const miniW = iconW * MINI_SCALE;
		const miniH = iconH * MINI_SCALE;
		const miniCx = cx - hexW / 4;
		const miniCy = cy - hexH / 4;
		return {
			iconW: miniW,
			iconH: miniH,
			left: miniCx - miniW / 2,
			top: miniCy - miniH / 2,
		};
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
		let iconEl = this.iconElements.get(key);

		if (!iconEl) {
			const { iconW, iconH, left, top } = this.layout(cx, cy, hexW, hexH);
			iconEl = container.createEl("img", { cls: "hexcrawl-hex-icon" });
			iconEl.draggable = false;
			iconEl.tabIndex = -1;
			iconEl.addEventListener("dragstart", (e) => e.preventDefault());
			iconEl.style.width = `${iconW}px`;
			iconEl.style.height = `${iconH}px`;
			iconEl.style.left = `${left}px`;
			iconEl.style.top = `${top}px`;
			this.iconElements.set(key, iconEl);
		}
		iconEl.src = src;
		iconEl.alt = alt;
	}
}
