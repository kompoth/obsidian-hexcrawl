import { MarkdownPostProcessorContext, MarkdownRenderChild } from "obsidian";

const MIN_SCALE = 0.2;
const MAX_SCALE = 5;
const ZOOM_STEP = 1.1;
const DRAG_THRESHOLD = 5;

/**
 * Wires wheel-zoom and drag-to-pan onto clipEl/viewportEl; a plain (non-drag) click fires
 * onClick. While isPaintMode() is true, a pointer-down starts painting instead of panning:
 * onPaint fires on pointerdown and on every subsequent pointermove, letting the caller paint
 * a continuous line of hexes instead of one hex per click; onPaintEnd fires once the stroke
 * is released, so the caller can group it into a single undo step.
 */
export function setupPanAndZoom(
	container: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	clipEl: HTMLElement,
	viewportEl: HTMLElement,
	totalSize: { width: number; height: number },
	onClick: (e: PointerEvent) => void,
	isPaintMode: () => boolean,
	onPaint: (e: PointerEvent) => void,
	onPaintEnd: () => void,
): void {
	let scale = 1;
	let panX = 0;
	let panY = 0;
	let userInteracted = false;

	const applyTransform = () => {
		viewportEl.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
	};

	const fitAndCenter = () => {
		const cw = clipEl.clientWidth;
		const ch = clipEl.clientHeight;
		if (cw <= 0 || ch <= 0) return;
		scale = Math.min(1, cw / totalSize.width, ch / totalSize.height);
		scale = Math.max(scale, MIN_SCALE);
		panX = (cw - totalSize.width * scale) / 2;
		panY = (ch - totalSize.height * scale) / 2;
		applyTransform();
	};

	// The container has no layout size yet on the first synchronous call
	// (markdown post-processors run before the element is necessarily
	// painted), so fit-and-center is driven off ResizeObserver instead of
	// a one-shot measurement. It keeps re-centering on resize only until
	// the user takes over the view themselves.
	const resizeObserver = new ResizeObserver(() => {
		if (!userInteracted) fitAndCenter();
	});
	resizeObserver.observe(clipEl);

	const renderChild = new MarkdownRenderChild(container);
	renderChild.onunload = () => resizeObserver.disconnect();
	ctx.addChild(renderChild);

	clipEl.addEventListener(
		"wheel",
		(e: WheelEvent) => {
			e.preventDefault();
			userInteracted = true;
			const rect = clipEl.getBoundingClientRect();
			const cursorX = e.clientX - rect.left;
			const cursorY = e.clientY - rect.top;
			const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
			const newScale = Math.min(Math.max(scale * factor, MIN_SCALE), MAX_SCALE);
			const worldX = (cursorX - panX) / scale;
			const worldY = (cursorY - panY) / scale;
			scale = newScale;
			panX = cursorX - worldX * scale;
			panY = cursorY - worldY * scale;
			applyTransform();
		},
		{ passive: false },
	);

	let dragging = false;
	let painting = false;
	let moved = false;
	let lastX = 0;
	let lastY = 0;

	clipEl.addEventListener("pointerdown", (e: PointerEvent) => {
		// Right/middle button: leave it alone entirely rather than preventDefault()-ing it.
		// Chromium ties the native "contextmenu" event's firing to whether the triggering
		// pointerdown/mousedown had its default action prevented, so calling preventDefault()
		// here for a right-click would silently suppress every border/path segment's
		// right-click-to-remove handler downstream.
		if (e.button !== 0) return;

		// Without this, the browser's default action on a mouse-down-and-move
		// is to start a native text/content selection drag — which on a plain
		// div still works and lets the user drop a copy of a hex (icon or not)
		// elsewhere on the page. Suppressing it here leaves only our own pan.
		e.preventDefault();
		userInteracted = true;
		clipEl.setPointerCapture(e.pointerId);
		// preventDefault() above also suppresses the browser's default click-to-focus, which
		// undo/redo's keyboard shortcut relies on (it's scoped to this element so it doesn't
		// fight with Obsidian's own editor undo).
		clipEl.focus();

		if (isPaintMode()) {
			painting = true;
			onPaint(e);
			return;
		}

		dragging = true;
		moved = false;
		lastX = e.clientX;
		lastY = e.clientY;
		clipEl.addClass("hexcrawl-dragging");
	});

	clipEl.addEventListener("pointermove", (e: PointerEvent) => {
		if (painting) {
			onPaint(e);
			return;
		}
		if (!dragging) return;
		const dx = e.clientX - lastX;
		const dy = e.clientY - lastY;
		if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) moved = true;
		panX += dx;
		panY += dy;
		lastX = e.clientX;
		lastY = e.clientY;
		applyTransform();
	});

	const endDrag = (e: PointerEvent) => {
		if (painting) {
			painting = false;
			onPaintEnd();
			return;
		}
		if (!dragging) return;
		dragging = false;
		clipEl.removeClass("hexcrawl-dragging");
		if (!moved) onClick(e);
	};
	clipEl.addEventListener("pointerup", endDrag);
	clipEl.addEventListener("pointercancel", endDrag);
}
