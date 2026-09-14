import { setTooltip } from "obsidian";
import type { HexcrawlBlockParams, HexNoteData } from "./types";
import { hexCenter, hexSize } from "./hexGeometry";
import { resolvePaletteEntry } from "./pure";

/** The hex grid's terrain-color layer — its cells double as the click hit-targets used by tool
 *  painting and note-opening, so this is also where those cells physically live. */
export class TerrainLayer {
	private el: HTMLElement | null = null;
	private hexElements = new Map<string, HTMLElement>();
	private hexColors = new Map<string, string>();
	private visible = true;

	constructor(private params: HexcrawlBlockParams) {}

	mount(viewportEl: HTMLElement): void {
		this.el = viewportEl.createDiv({ cls: ["hexcrawl-layer", "hexcrawl-layer-terrain"] });
	}

	render(hexNotes: Map<string, HexNoteData>, gutter: number): void {
		if (!this.el) return;
		const { orientation, stagger, hexSize: radius, cols, rows, palette } = this.params;
		const { w: hexW, h: hexH } = hexSize(radius, orientation);

		for (let r = 0; r < rows; r++) {
			for (let q = 0; q < cols; q++) {
				const key = `${q},${r}`;
				const center = hexCenter(q, r, orientation, radius, stagger);
				const note = hexNotes.get(key);

				const hexEl = this.el.createDiv({
					cls: `hexcrawl-hex hexcrawl-hex-${orientation}${note ? " hexcrawl-hex-configured" : ""}`,
					attr: {
						"data-q": String(q),
						"data-r": String(r),
						...(note ? { "data-note-path": note.path } : {}),
					},
				});
				hexEl.style.width = `${hexW}px`;
				hexEl.style.height = `${hexH}px`;
				hexEl.style.left = `${gutter + center.cx - hexW / 2}px`;
				hexEl.style.top = `${gutter + center.cy - hexH / 2}px`;

				const color = resolvePaletteEntry(note, palette)?.color ?? note?.terrain ?? "";
				this.hexColors.set(key, color);
				if (this.visible && color) hexEl.style.backgroundColor = color;

				if (note && !note.name.startsWith("_")) setTooltip(hexEl, note.name);

				this.hexElements.set(key, hexEl);
			}
		}
	}

	/** Re-derives one hex's color/tooltip/clickability from its current note data. */
	updateHex(q: number, r: number, note: HexNoteData): void {
		const key = `${q},${r}`;
		const hexEl = this.hexElements.get(key);
		if (!hexEl) return;

		const color = resolvePaletteEntry(note, this.params.palette)?.color ?? note.terrain ?? "";
		this.hexColors.set(key, color);
		if (this.visible) hexEl.style.backgroundColor = color;

		hexEl.setAttr("data-note-path", note.path);
		hexEl.addClass("hexcrawl-hex-configured");
		if (!note.name.startsWith("_")) setTooltip(hexEl, note.name);
	}

	/**
	 * Shows/hides terrain colors only — hex cells stay in place and clickable either way,
	 * since they also serve as the map's click hit-targets for tool painting and note-opening.
	 */
	setVisible(visible: boolean): void {
		if (this.visible === visible) return;
		this.visible = visible;
		for (const [key, hexEl] of this.hexElements) {
			hexEl.style.backgroundColor = visible ? (this.hexColors.get(key) ?? "") : "";
		}
	}

	get isVisible(): boolean {
		return this.visible;
	}
}
