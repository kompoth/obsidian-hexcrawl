import type { PathDashStyle } from "../types";

/** stroke-dasharray for a dash style, scaled to the line's width. */
export function dashArray(dash: PathDashStyle, width: number): string {
	if (dash === "dotted") return `${width * 0.4} ${width * 1.8}`;
	if (dash === "dashed") return `${width * 2.5} ${width * 1.8}`;
	return "none";
}
