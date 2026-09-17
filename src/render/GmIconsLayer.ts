import { App } from "obsidian";
import type { HexcrawlBlockParams, HexNoteData } from "../types";
import { hexCenter, hexKey, hexSize } from "./hexGeometry";
import { resolveIcons } from "../dataLoaders";
import { resolveIconsFolder, resolveGmIconName } from "../palette";

const ICON_SCALE = 0.9;
/** "mini" mode renders the icon at half the size used by "default" mode. */
const MINI_SCALE = 0.5;

/** Called when an icon is dropped onto another hex, to let the caller move hex-gm-icon there. */
export type IconMoveHandler = (
	fromQ: number,
	fromR: number,
	toQ: number,
	toR: number,
) => void;

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
	/** Whether Move mode is selected in the GM Icon tool's drawer — only then are icons draggable. */
	private dragEnabled = false;

	constructor(
		private app: App,
		private params: HexcrawlBlockParams,
		private onMove: IconMoveHandler,
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

	/** Toggles whether icons can be dragged to another hex — called as Move mode is
	 *  selected/deselected in the GM Icon tool's drawer. Every rendered GM icon is an explicit
	 *  hex-gm-icon value (there's no palette fallback), so all of them are draggable while enabled. */
	setDragEnabled(enabled: boolean): void {
		if (this.dragEnabled === enabled) return;
		this.dragEnabled = enabled;
		for (const iconEl of this.iconElements.values())
			iconEl.toggleClass("is-draggable", enabled);
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
					q,
					r,
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
				q,
				r,
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
		q: number,
		r: number,
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
			this.attachIconDrag(iconEl, q, r);
		}
		iconEl.src = src;
		iconEl.alt = alt;
		iconEl.toggleClass("is-draggable", this.dragEnabled);
	}

	/**
	 * Drag-to-move an icon: dropping it onto another hex moves its hex-gm-icon value there and
	 * clears it from this one. The element only receives pointer events at all while it has the
	 * "is-draggable" class (see .hexcrawl-hex-icon's default pointer-events: none in
	 * styles.css), so this handler is otherwise inert.
	 */
	private attachIconDrag(iconEl: HTMLImageElement, q: number, r: number): void {
		iconEl.addEventListener("pointerdown", (e: PointerEvent) => {
			if (e.button !== 0) return;
			e.stopPropagation();
			e.preventDefault();
			iconEl.setPointerCapture(e.pointerId);
			iconEl.addClass("is-dragging");
			let hoverHex: HTMLElement | null = null;

			const highlight = (ev: PointerEvent) => {
				const hit = document.elementFromPoint(ev.clientX, ev.clientY);
				const hexEl = hit?.closest(".hexcrawl-hex");
				const next = hexEl instanceof HTMLElement ? hexEl : null;
				if (next !== hoverHex) {
					hoverHex?.removeClass("hexcrawl-hex-drop-target");
					hoverHex = next;
					hoverHex?.addClass("hexcrawl-hex-drop-target");
				}
				return hoverHex;
			};

			const onMove = (ev: PointerEvent) => highlight(ev);
			const onUp = (ev: PointerEvent) => {
				iconEl.removeEventListener("pointermove", onMove);
				iconEl.removeEventListener("pointerup", onUp);
				iconEl.removeClass("is-dragging");
				const hexEl = highlight(ev);
				hexEl?.removeClass("hexcrawl-hex-drop-target");
				if (!hexEl) return;
				const toQ = Number(hexEl.getAttribute("data-q"));
				const toR = Number(hexEl.getAttribute("data-r"));
				if (!Number.isInteger(toQ) || !Number.isInteger(toR)) return;
				if (toQ === q && toR === r) return;
				this.onMove(q, r, toQ, toR);
			};
			iconEl.addEventListener("pointermove", onMove);
			iconEl.addEventListener("pointerup", onUp);
		});
	}
}
