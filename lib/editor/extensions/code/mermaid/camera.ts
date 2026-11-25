/**
 * Where the diagram sits in the viewer: its top-left corner (`x`, `y`, in the
 * stage's pixels) and its scale. Pure, so the zoom and pan maths is testable.
 */
export interface Camera {
	x: number;
	y: number;
	scale: number;
}

export interface Size {
	width: number;
	height: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 10;
/** Fitting never blows a small diagram up past this. */
const MAX_FIT = 2;

export const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/** Zooms by `factor`, keeping the point `(px, py)` of the stage still (under the pointer). */
export function zoomAt(camera: Camera, factor: number, px: number, py: number): Camera {
	const scale = clampScale(camera.scale * factor);
	const k = scale / camera.scale;
	return { scale, x: px - (px - camera.x) * k, y: py - (py - camera.y) * k };
}

/** Moves by `(dx, dy)` stage pixels. */
export const panBy = (camera: Camera, dx: number, dy: number): Camera => ({
	...camera,
	x: camera.x + dx,
	y: camera.y + dy,
});

/** The diagram at `scale`, centred in the stage. */
export function centred(content: Size, stage: Size, scale: number): Camera {
	const s = clampScale(scale);
	return {
		scale: s,
		x: (stage.width - content.width * s) / 2,
		y: (stage.height - content.height * s) / 2,
	};
}

/** The whole diagram in view, centred, with `pad` px around it. */
export function fit(content: Size, stage: Size, pad = 32): Camera {
	const scale = Math.min(
		MAX_FIT,
		(stage.width - pad * 2) / content.width,
		(stage.height - pad * 2) / content.height,
	);
	return centred(content, stage, scale > 0 ? scale : MIN_SCALE);
}

/** How a wheel event zooms: a factor above 1 zooms in. Pinch on a trackpad comes with `ctrlKey`. */
export function wheelFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
	const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
	return Math.exp(-pixels * (ctrlKey ? 0.01 : 0.002));
}
