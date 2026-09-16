import { App, setIcon, setTooltip } from "obsidian";
import type { HexcrawlBlockParams } from "../types";
import { resolveIcons } from "../dataLoaders";
import { resolveIconsFolder } from "../palette";

export type ToolKind =
	"brush" | "bucket" | "icon" | "gm-icon" | "path" | "border" | "layers";

/** What's currently picked in the drawer: the eraser, or a named palette/icon value. */
export type DrawerSelection = { erase: true } | { erase: false; value: string };

/** Toolbar tools, top to bottom. */
const TOOLS: { kind: ToolKind; icon: string; label: string }[] = [
	{ kind: "brush", icon: "hexagon", label: "Brush" },
	{ kind: "bucket", icon: "paint-bucket", label: "Bucket" },
	{ kind: "icon", icon: "flag", label: "Icon" },
	{ kind: "gm-icon", icon: "hat-glasses", label: "GM Icon" },
	{ kind: "path", icon: "route", label: "Path" },
	{ kind: "border", icon: "fence", label: "Border" },
	{ kind: "layers", icon: "layers", label: "Layers" },
];

/** Bottom-drawer preview+label item; shared by every tool's drawer content, including the Path tool's. */
export function createDrawerItem(
	scrollEl: HTMLElement,
	label: string,
	onSelect: () => void = () => {},
): { itemEl: HTMLElement; previewEl: HTMLElement } {
	const itemEl = scrollEl.createDiv({
		cls: "hexcrawl-drawer-item",
		attr: { role: "button", tabindex: "0" },
	});
	const previewEl = itemEl.createDiv({ cls: "hexcrawl-drawer-item-preview" });
	itemEl.createDiv({ cls: "hexcrawl-drawer-item-label", text: label });

	itemEl.addEventListener("click", () => {
		for (const child of Array.from(scrollEl.children) as HTMLElement[])
			child.removeClass("is-selected");
		itemEl.addClass("is-selected");
		onSelect();
	});
	itemEl.addEventListener("keydown", (e: KeyboardEvent) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			itemEl.click();
		}
	});
	return { itemEl, previewEl };
}

export function addDrawerPreviewImage(
	previewEl: HTMLElement,
	src: string,
	alt: string,
): void {
	const imgEl = previewEl.createEl("img", { cls: "hexcrawl-drawer-item-img" });
	imgEl.src = src;
	imgEl.alt = alt;
	imgEl.draggable = false;
	imgEl.addEventListener("dragstart", (e) => e.preventDefault());
}

export function renderDrawerEmpty(scrollEl: HTMLElement, text: string): void {
	scrollEl.createDiv({ cls: "hexcrawl-drawer-empty", text });
}

/** A drawer item that toggles on/off (an eye/eye-off icon) instead of single-selecting like `createDrawerItem`. */
export function createDrawerToggleItem(
	scrollEl: HTMLElement,
	label: string,
	isOn: () => boolean,
	onToggle: () => void,
): void {
	const itemEl = scrollEl.createDiv({
		cls: "hexcrawl-drawer-item",
		attr: { role: "button", tabindex: "0" },
	});
	const previewEl = itemEl.createDiv({ cls: "hexcrawl-drawer-item-preview" });
	itemEl.createDiv({ cls: "hexcrawl-drawer-item-label", text: label });

	const updateIcon = () => {
		previewEl.empty();
		setIcon(previewEl, isOn() ? "eye" : "eye-off");
	};
	updateIcon();

	const toggle = () => {
		onToggle();
		updateIcon();
	};
	itemEl.addEventListener("click", toggle);
	itemEl.addEventListener("keydown", (e: KeyboardEvent) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			toggle();
		}
	});
}

interface ToolbarHooks {
	/** Called right after the active tool changes (including to null), before the new drawer is populated. */
	onToolChange: (kind: ToolKind | null) => void;
	/** Delegate for populating the Path tool's own drawer content. */
	populatePathDrawer: (scrollEl: HTMLElement) => void;
	/** Delegate for populating the Border tool's own drawer content. */
	populateBorderDrawer: (scrollEl: HTMLElement) => void;
	/** Delegate for populating the Layers tool's own drawer content. */
	populateLayersDrawer: (scrollEl: HTMLElement) => void;
}

/** Toolbar of single-select tool toggles plus the bottom drawer, pinned to the top-right corner regardless of pan/zoom. */
export class Toolbar {
	private _activeTool: ToolKind | null = null;
	private _drawerSelection: DrawerSelection | null = null;
	private scrollEl: HTMLElement | null = null;
	private drawerEl: HTMLElement | null = null;
	private clipEl: HTMLElement | null = null;
	private buttons: HTMLElement[] = [];
	/** Bumped on every populateDrawer() call so a stale async populate (from a tool switch
	 *  mid-flight) can detect it's no longer current and skip rendering into the drawer. */
	private drawerRenderId = 0;

	constructor(
		private app: App,
		private params: HexcrawlBlockParams,
		private hooks: ToolbarHooks,
	) {}

	get activeTool(): ToolKind | null {
		return this._activeTool;
	}

	get drawerSelection(): DrawerSelection | null {
		return this._drawerSelection;
	}

	mount(clipEl: HTMLElement): void {
		const toolbarEl = clipEl.createDiv({ cls: "hexcrawl-toolbar" });
		// Interactions inside the toolbar shouldn't also pan/zoom the map underneath.
		toolbarEl.addEventListener("pointerdown", (e) => e.stopPropagation());
		toolbarEl.addEventListener("wheel", (e) => e.stopPropagation());

		const drawerEl = clipEl.createDiv({ cls: "hexcrawl-drawer" });
		drawerEl.hidden = true;
		drawerEl.addEventListener("pointerdown", (e) => e.stopPropagation());
		const scrollEl = drawerEl.createDiv({ cls: "hexcrawl-drawer-scroll" });
		drawerEl.addEventListener("wheel", (e: WheelEvent) => {
			e.stopPropagation();
			// The drawer only ever scrolls horizontally (overflow-x: auto, overflow-y:
			// hidden), which an ordinary mouse wheel's vertical delta doesn't drive on its
			// own — only Shift+wheel or a trackpad's native horizontal gesture would. Redirect
			// the vertical delta into horizontal scroll so a plain wheel works too.
			e.preventDefault();
			scrollEl.scrollLeft += e.deltaY || e.deltaX;
		});
		this.scrollEl = scrollEl;
		this.drawerEl = drawerEl;
		this.clipEl = clipEl;

		for (const tool of TOOLS) {
			const btn = toolbarEl.createDiv({
				cls: "hexcrawl-tool-btn",
				attr: { role: "button", tabindex: "0", "aria-pressed": "false" },
			});
			setIcon(btn, tool.icon);
			setTooltip(btn, tool.label);

			btn.addEventListener("keydown", (e: KeyboardEvent) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					btn.click();
				}
			});
			btn.addEventListener("click", () => {
				if (btn.hasClass("is-active")) {
					this.deactivate();
					return;
				}
				for (const other of this.buttons) {
					other.removeClass("is-active");
					other.setAttr("aria-pressed", "false");
				}
				btn.addClass("is-active");
				btn.setAttr("aria-pressed", "true");
				drawerEl.hidden = false;
				this._activeTool = tool.kind;
				this._drawerSelection = null;
				this.hooks.onToolChange(this._activeTool);
				this.populateDrawer(scrollEl, tool.kind);
			});
			this.buttons.push(btn);
		}
	}

	/** Turns off whichever tool is active and hides the drawer — shared by a tool button
	 *  toggling itself off and by the drawer's own "Exit" item. */
	private deactivate(): void {
		for (const btn of this.buttons) {
			btn.removeClass("is-active");
			btn.setAttr("aria-pressed", "false");
		}
		if (this.drawerEl) this.drawerEl.hidden = true;
		this._activeTool = null;
		this._drawerSelection = null;
		this.hooks.onToolChange(null);
		// Hiding the drawer blurs a focused item inside it (e.g. this "Exit" click itself)
		// out to <body> — reclaim focus so the map's undo/redo shortcut keeps working.
		this.clipEl?.focus();
	}

	/** Re-renders the drawer for whichever tool is currently active — used after Path-tool state changes. */
	refreshDrawer(): void {
		if (this.scrollEl && this._activeTool)
			this.populateDrawer(this.scrollEl, this._activeTool);
	}

	private populateDrawer(scrollEl: HTMLElement, kind: ToolKind): void {
		scrollEl.empty();
		// Emptying can blur a focused drawer item (e.g. "Confirm Delete", just clicked) out
		// to <body> — reclaim focus so the map's undo/redo shortcut keeps working afterward.
		this.clipEl?.focus();
		const renderId = ++this.drawerRenderId;
		// Added first, not after the tool-specific items, so its position doesn't depend on
		// the async terrain/icon populates below resolving before or after this runs.
		this.addExitItem(scrollEl);
		if (kind === "brush" || kind === "icon" || kind === "gm-icon")
			this.addEraserItem(scrollEl);
		switch (kind) {
			case "brush":
			case "bucket":
				void this.populateTerrainDrawer(scrollEl, renderId);
				break;
			case "icon":
			case "gm-icon":
				void this.populateIconDrawer(scrollEl, renderId);
				break;
			case "path":
				this.hooks.populatePathDrawer(scrollEl);
				break;
			case "border":
				this.hooks.populateBorderDrawer(scrollEl);
				break;
			case "layers":
				this.hooks.populateLayersDrawer(scrollEl);
				break;
		}
	}

	/** Returns to default mode without undoing any already-completed edits. */
	private addExitItem(scrollEl: HTMLElement): void {
		const { previewEl } = createDrawerItem(scrollEl, "Exit", () =>
			this.deactivate(),
		);
		setIcon(previewEl, "log-out");
		previewEl.addClass("is-danger");
	}

	private addEraserItem(scrollEl: HTMLElement): void {
		const { previewEl } = createDrawerItem(scrollEl, "Eraser", () => {
			this._drawerSelection = { erase: true };
		});
		setIcon(previewEl, "eraser");
	}

	private async populateTerrainDrawer(
		scrollEl: HTMLElement,
		renderId: number,
	): Promise<void> {
		const terrain = this.params.palette?.terrain ?? {};
		const names = Object.keys(terrain).sort();
		if (names.length === 0) {
			renderDrawerEmpty(scrollEl, "No terrain in palette");
			return;
		}
		const iconsFolder = resolveIconsFolder(this.params);
		const iconSrcs = await resolveIcons(this.app, iconsFolder);
		if (renderId !== this.drawerRenderId) return;
		for (const name of names) {
			const entry = terrain[name];
			const { previewEl } = createDrawerItem(scrollEl, name, () => {
				this._drawerSelection = { erase: false, value: name };
			});
			if (entry.color) previewEl.style.backgroundColor = entry.color;
			if (entry.icon) {
				const iconSrc = iconSrcs.get(entry.icon);
				if (iconSrc) addDrawerPreviewImage(previewEl, iconSrc, entry.icon);
			}
		}
	}

	private async populateIconDrawer(
		scrollEl: HTMLElement,
		renderId: number,
	): Promise<void> {
		const iconsFolder = resolveIconsFolder(this.params);
		const iconSrcs = await resolveIcons(this.app, iconsFolder);
		if (renderId !== this.drawerRenderId) return;
		const sortedIcons = [...iconSrcs].sort(([a], [b]) => a.localeCompare(b));
		if (sortedIcons.length === 0) {
			renderDrawerEmpty(scrollEl, "No icons found");
			return;
		}
		for (const [name, src] of sortedIcons) {
			const { previewEl } = createDrawerItem(scrollEl, name, () => {
				this._drawerSelection = { erase: false, value: name };
			});
			addDrawerPreviewImage(previewEl, src, name);
		}
	}
}
