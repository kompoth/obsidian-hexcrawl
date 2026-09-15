import type { PathDashStyle, PathStyleEntry } from "../types";

export const DEFAULT_PATH_WIDTH = 3;

/** stroke-dasharray for a dash style, scaled to the line's width. */
export function dashArray(dash: PathDashStyle, width: number): string {
	if (dash === "dotted") return `${width * 0.4} ${width * 1.8}`;
	if (dash === "dashed") return `${width * 2.5} ${width * 1.8}`;
	return "none";
}

/** Renders a path type's color/width/dash onto a preview swatch's top border — shared by the
 *  Path tool's drawer and the palette settings' terrain/path-type previews. */
export function applyPathPreviewStyle(
	el: HTMLElement,
	style: PathStyleEntry,
): void {
	el.style.borderTopColor = style.color ?? "var(--text-muted)";
	el.style.borderTopWidth = `${Math.min(Math.max(style.width ?? DEFAULT_PATH_WIDTH, 1), 6)}px`;
	el.style.borderTopStyle =
		style.dash === "dotted" || style.dash === "dashed" ? style.dash : "solid";
}
