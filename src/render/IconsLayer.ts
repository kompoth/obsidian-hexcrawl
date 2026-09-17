import { App } from "obsidian";
import type { HexcrawlBlockParams, HexNoteData } from "../types";
import { hexCenter, hexKey, hexSize } from "./hexGeometry";
import { resolveIcons } from "../dataLoaders";
import { resolveIconName } from "../palette";

const ICON_SCALE = 0.9;

/** Called when a draggable icon (an explicit hex-icon override) is dropped onto another hex,
 *  to let the caller move that override there. */
export type IconMoveHandler = (
	fromQ: number,
	fromR: number,
	toQ: number,
	toR: number,
) => void;

/** Hex icons — from the terrain palette's default, or a hex's own hex-icon override. */
export class IconsLayer {
	private el: HTMLElement | null = null;
	private iconElements = new Map<string, HTMLImageElement>();
	private iconSrcs: Map<string, string> = new Map();
	private gutter = 0;
	private visible = true;
	/** Whether Move mode is selected in the Icon tool's drawer — only then are icons draggable. */
	private dragEnabled = false;
	/** Keys of hexes whose icon is an explicit hex-icon override (as opposed to one inherited
	 *  from the terrain palette) — only these can be dragged to another hex. */
	private draggableKeys = new Set<string>();

	constructor(
		private app: App,
		private params: HexcrawlBlockParams,
		private onMove: IconMoveHandler,
	) {}

	async load(iconsFolder: string | undefined): Promise<void> {
		this.iconSrcs = await resolveIcons(this.app, iconsFolder);
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

	/** Toggles whether icons with an explicit hex-icon override can be dragged to another hex —
	 *  called as Move mode is selected/deselected in the Icon tool's drawer. */
	setDragEnabled(enabled: boolean): void {
		if (this.dragEnabled === enabled) return;
		this.dragEnabled = enabled;
		for (const [key, iconEl] of this.iconElements)
			iconEl.toggleClass(
				"is-draggable",
				enabled && this.draggableKeys.has(key),
			);
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
				const iconName = resolveIconName(note, palette);
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
					note?.icon !== undefined,
				);
			}
		}
	}

	/** Re-derives one hex's icon (add/update/remove) from its current note data — or, if `note`
	 *  is undefined (an undo deleted the hex's last configured field's note), removes any icon. */
	updateHex(q: number, r: number, note: HexNoteData | undefined): void {
		const el = this.el;
		if (!el) return;
		const key = hexKey(q, r);
		const { orientation, stagger, hexSize: radius, palette } = this.params;
		const iconName = resolveIconName(note, palette);
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
				note?.icon !== undefined,
			);
		} else if (iconEl) {
			iconEl.remove();
			this.iconElements.delete(key);
			this.draggableKeys.delete(key);
		}
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
		isExplicit: boolean,
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
			this.attachIconDrag(iconEl, q, r);
		}
		iconEl.src = src;
		iconEl.alt = alt;
		if (isExplicit) this.draggableKeys.add(key);
		else this.draggableKeys.delete(key);
		iconEl.toggleClass("is-draggable", isExplicit && this.dragEnabled);
	}

	/**
	 * Drag-to-move for an icon with an explicit hex-icon override: dropping it onto another hex
	 * moves the override there and clears it from this one. The element only receives pointer
	 * events at all while it has the "is-draggable" class (see .hexcrawl-hex-icon's default
	 * pointer-events: none in styles.css), so this handler is otherwise inert.
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
