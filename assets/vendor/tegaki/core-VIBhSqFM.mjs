import { a as CSS_PROGRESS, c as MIN_PADDING_V_EM, f as cssFontFamily, g as subdivideStroke, h as resolveCSSLength, i as CSS_DURATION, l as PADDING_H_EM, m as lookupGlyphData, n as computeTimeline, o as CSS_TIME, p as graphemes, r as placementsToSvg, s as MIN_LINE_HEIGHT_EM, u as registerCssProperties } from "./textToSvg-GTQMM8Le.mjs";
//#region src/lib/effects.ts
const defaultEffects = { pressureWidth: true };
const knownEffects = {
	glow: {},
	wobble: {},
	pressureWidth: {},
	taper: {},
	strokeGradient: {},
	globalGradient: { beforeRender(stage, config) {
		const colors = config.colors;
		if (!Array.isArray(colors) || colors.length === 0) return;
		const { ctx, bbox } = stage;
		const rad = (config.angle ?? 0) * Math.PI / 180;
		const dx = Math.cos(rad);
		const dy = Math.sin(rad);
		const cx = bbox.x + bbox.width / 2;
		const cy = bbox.y + bbox.height / 2;
		const halfW = bbox.width / 2;
		const halfH = bbox.height / 2;
		const proj = Math.abs(dx * halfW) + Math.abs(dy * halfH);
		const grad = ctx.createLinearGradient(cx - dx * proj, cy - dy * proj, cx + dx * proj, cy + dy * proj);
		if (colors.length === 1) {
			grad.addColorStop(0, colors[0]);
			grad.addColorStop(1, colors[0]);
		} else for (let i = 0; i < colors.length; i++) grad.addColorStop(i / (colors.length - 1), colors[i]);
		stage.strokeStyle = grad;
	} }
};
/**
* Normalizes an effects record into a sorted array of resolved effects.
* Known keys infer the effect name; custom keys read it from the `effect` field.
* Boolean `true` becomes an empty config. `false`/absent entries are skipped.
*/
function resolveEffects(effects) {
	const merged = {
		...defaultEffects,
		...effects
	};
	const result = [];
	for (const [key, value] of Object.entries(merged)) {
		if (value === false || value == null) continue;
		let effectName;
		let config;
		let order;
		if (value === true) {
			effectName = Object.hasOwn(knownEffects, key) ? key : void 0;
			if (!effectName) continue;
			config = {};
			order = 0;
		} else {
			if (value.enabled === false) continue;
			effectName = value.effect ?? (Object.hasOwn(knownEffects, key) ? key : void 0);
			if (!effectName) continue;
			const { effect: _, order: o, enabled: __, ...rest } = value;
			config = rest;
			order = o ?? 0;
		}
		result.push({
			effect: effectName,
			order,
			config
		});
	}
	result.sort((a, b) => a.order - b.order);
	return result;
}
/** Check if a specific effect is active. */
function findEffect(effects, name) {
	return effects.find((e) => e.effect === name);
}
/** Get all instances of a specific effect (for duplicates). */
function findEffects(effects, name) {
	return effects.filter((e) => e.effect === name);
}
/** Look up the render-hook metadata for an effect name. Unknown names return undefined. */
function getEffectDefinition(name) {
	return Object.hasOwn(knownEffects, name) ? knownEffects[name] : void 0;
}
/** True when any resolved effect defines a before/after render hook. */
function hasRenderHooks(effects) {
	for (const e of effects) {
		const def = getEffectDefinition(e.effect);
		if (def?.beforeRender || def?.afterRender) return true;
	}
	return false;
}
//#endregion
//#region src/lib/drawGlyph.ts
function parseColor(color) {
	const h = color.replace("#", "");
	if (h.length === 3) return [
		parseInt(h[0] + h[0], 16),
		parseInt(h[1] + h[1], 16),
		parseInt(h[2] + h[2], 16),
		1
	];
	if (h.length === 4) return [
		parseInt(h[0] + h[0], 16),
		parseInt(h[1] + h[1], 16),
		parseInt(h[2] + h[2], 16),
		parseInt(h[3] + h[3], 16) / 255
	];
	if (h.length === 8) return [
		parseInt(h.slice(0, 2), 16),
		parseInt(h.slice(2, 4), 16),
		parseInt(h.slice(4, 6), 16),
		parseInt(h.slice(6, 8), 16) / 255
	];
	return [
		parseInt(h.slice(0, 2), 16),
		parseInt(h.slice(2, 4), 16),
		parseInt(h.slice(4, 6), 16),
		1
	];
}
function lerpColor(a, b, t) {
	const r = Math.round(a[0] + (b[0] - a[0]) * t);
	const g = Math.round(a[1] + (b[1] - a[1]) * t);
	const bl = Math.round(a[2] + (b[2] - a[2]) * t);
	const al = a[3] + (b[3] - a[3]) * t;
	if (al >= 1) return `rgb(${r},${g},${bl})`;
	return `rgba(${r},${g},${bl},${al.toFixed(3)})`;
}
function gradientColor(progress, colors, seed) {
	if (colors.length === 0) return "#000";
	if (colors.length === 1) return colors[0];
	const scaledT = ((progress + seed * .1) % 1 + 1) % 1 * (colors.length - 1);
	const i = Math.min(Math.floor(scaledT), colors.length - 2);
	const frac = scaledT - i;
	return lerpColor(parseColor(colors[i]), parseColor(colors[i + 1]), frac);
}
function rainbowColor(progress, saturation, lightness, seed) {
	return `hsl(${(progress * 360 + seed * 137.5) % 360}, ${saturation}%, ${lightness}%)`;
}
function hash(x) {
	let h = x * 2654435761 | 0;
	h = (h >>> 16 ^ h) * 73244475;
	h = (h >>> 16 ^ h) * 73244475;
	h = h >>> 16 ^ h;
	return (h & 2147483647) / 2147483647;
}
function noise1d(x, seed) {
	const i = Math.floor(x);
	const f = x - i;
	const t = f * f * (3 - 2 * f);
	return hash(i + seed * 7919) * (1 - t) + hash(i + 1 + seed * 7919) * t;
}
/** Default stroke easing: ease-out exponential. */
function defaultStrokeEasing(t) {
	return 1 - (1 - t) * (1 - t);
}
/**
* Draw a single glyph's strokes onto a canvas context, animated up to `localTime`.
* `localTime` is seconds relative to this glyph's start (0 = glyph begins).
*
* `getSubdivided` returns a shared, cached subdivision of each stroke (in font
* units, pre-wobble). The engine owns the cache and invalidates it when the
* font, fontSize, or segment size changes; if omitted here, strokes are
* subdivided inline each call (useful for testing).
*
* `strokeDelays` is a sparse per-stroke override of the bundled `d` field. When
* `strokeDelays[i]` is a number, it replaces `glyph.s[i].d` as the stroke's
* delay relative to `localTime = 0`. Used by the timeline scheduler to defer
* priority-tagged strokes (disconnected marks / i-dots / Arabic nuqṭa) to
* after every body stroke in the word has drawn.
*
* `strokeTimeScale` multiplies both bundled `d` and `a` so a glyph's strokes
* fit a stretched/compressed time slot (used by stagger mode with a static
* `duration`). Defaults to `1` (no scaling). `strokeDelays` are already
* scheduler-relative seconds and are not affected by this scale.
*/
function drawGlyph(ctx, glyph, pos, localTime, lineCap, color, effects = [], seed = 0, getSubdivided, strokeEasing = defaultStrokeEasing, strokeScale = 1, strokeStyleOverride, strokeDelays, strokeTimeScale = 1) {
	const defaultStrokePaint = strokeStyleOverride ?? color;
	const scale = pos.fontSize / pos.unitsPerEm;
	const ox = pos.x;
	const oy = pos.y;
	const glowEffects = findEffects(effects, "glow");
	const wobbleEffect = findEffect(effects, "wobble");
	const pressureEffect = findEffect(effects, "pressureWidth");
	const taperEffect = findEffect(effects, "taper");
	const strokeGradientEffect = findEffect(effects, "strokeGradient");
	const pressureAmount = pressureEffect ? Math.max(0, Math.min(pressureEffect.config.strength ?? 1, 1)) : 0;
	const wobbleAmplitude = wobbleEffect ? wobbleEffect.config.amplitude ?? 1.5 : 0;
	const wobbleFrequency = wobbleEffect ? wobbleEffect.config.frequency ?? 8 : 0;
	const wobbleMode = wobbleEffect?.config.mode ?? "sine";
	const hasWobble = !!wobbleEffect;
	const taperStart = taperEffect ? Math.max(0, Math.min(taperEffect.config.startLength ?? .15, 1)) : 0;
	const taperEnd = taperEffect ? Math.max(0, Math.min(taperEffect.config.endLength ?? .15, 1)) : 0;
	const gradientColors = strokeGradientEffect?.config.colors;
	const isRainbow = gradientColors === "rainbow";
	const gradientColorStops = Array.isArray(gradientColors) ? gradientColors : void 0;
	const gradientSaturation = strokeGradientEffect?.config.saturation ?? 80;
	const gradientLightness = strokeGradientEffect?.config.lightness ?? 55;
	const hasStrokeGradient = !!strokeGradientEffect;
	const needsPerSegment = pressureAmount > 0 || !!taperEffect;
	const subdivide = getSubdivided ?? ((s) => subdivideStroke(s, Infinity));
	const wobbleDx = (_x, y, idx) => {
		if (!hasWobble) return 0;
		if (wobbleMode === "noise") return wobbleAmplitude * (noise1d(y * .1 + idx * .7, seed) * 2 - 1);
		return wobbleAmplitude * Math.sin(wobbleFrequency * (y * .01 + idx * .7) + seed);
	};
	const wobbleDy = (x, _y, idx) => {
		if (!hasWobble) return 0;
		if (wobbleMode === "noise") return wobbleAmplitude * (noise1d(x * .1 + idx * .5, seed * 1.3 + 1e3) * 2 - 1);
		return wobbleAmplitude * Math.cos(wobbleFrequency * (x * .01 + idx * .5) + seed * 1.3);
	};
	const px = (x) => ox + x * scale;
	const py = (y) => oy + (y + pos.ascender) * scale;
	const colorAt = (progress) => {
		if (isRainbow) return rainbowColor(progress, gradientSaturation, gradientLightness, seed);
		if (gradientColorStops) return gradientColor(progress, gradientColorStops, seed);
		return color;
	};
	const taperMultiplier = (progress) => {
		let m = 1;
		if (taperStart > 0 && progress < taperStart) m = Math.min(m, progress / taperStart);
		if (taperEnd > 0 && progress > 1 - taperEnd) m = Math.min(m, (1 - progress) / taperEnd);
		return m;
	};
	for (let si = 0; si < glyph.s.length; si++) {
		const stroke = glyph.s[si];
		const delay = strokeDelays?.[si] ?? stroke.d * strokeTimeScale;
		if (localTime < delay) continue;
		const elapsed = localTime - delay;
		const animDuration = stroke.a * strokeTimeScale;
		const linearProgress = animDuration > 0 ? Math.min(elapsed / animDuration, 1) : 1;
		const progress = strokeEasing ? strokeEasing(linearProgress) : linearProgress;
		const rawPts = stroke.p;
		if (rawPts.length === 0) continue;
		const isDegenerate = rawPts.length > 1 && rawPts.every((p) => p[0] === rawPts[0][0] && p[1] === rawPts[0][1]);
		if (rawPts.length === 1 || isDegenerate) {
			if (progress <= 0) continue;
			const p = rawPts[0];
			const dotX = px(p[0] + wobbleDx(p[0], p[1], 0));
			const dotY = py(p[1] + wobbleDy(p[0], p[1], 0));
			const baseLineWidth = Math.max(p[2], .5) * scale * strokeScale;
			let dotWidth = baseLineWidth + (Math.max(p[2], .5) * scale * strokeScale - baseLineWidth) * pressureAmount;
			dotWidth *= taperMultiplier(.5);
			for (const glow of glowEffects) {
				ctx.save();
				ctx.shadowBlur = resolveCSSLength(glow.config.radius ?? 8, pos.fontSize);
				ctx.shadowColor = glow.config.color ?? color;
				ctx.shadowOffsetX = (glow.config.offsetX ?? 0) * scale;
				ctx.shadowOffsetY = (glow.config.offsetY ?? 0) * scale;
				ctx.fillStyle = glow.config.color ?? color;
				ctx.beginPath();
				if (lineCap === "round") ctx.arc(dotX, dotY, dotWidth / 2, 0, Math.PI * 2);
				else ctx.rect(dotX - dotWidth / 2, dotY - dotWidth / 2, dotWidth, dotWidth);
				ctx.fill();
				ctx.restore();
			}
			ctx.fillStyle = hasStrokeGradient ? colorAt(0) : defaultStrokePaint;
			ctx.beginPath();
			if (lineCap === "round") {
				ctx.arc(dotX, dotY, dotWidth / 2, 0, Math.PI * 2);
				ctx.fill();
			} else ctx.fillRect(dotX - dotWidth / 2, dotY - dotWidth / 2, dotWidth, dotWidth);
			continue;
		}
		const { vertices, totalLen, avgWidth } = subdivide(stroke);
		if (vertices.length < 2 || totalLen <= 0) continue;
		const drawLen = totalLen * progress;
		if (drawLen <= 0) continue;
		const baseLineWidth = Math.max(avgWidth, .5) * scale * strokeScale;
		let lo = 0;
		let hi = vertices.length - 1;
		while (lo < hi) {
			const mid = lo + hi + 1 >>> 1;
			if (vertices[mid].cumLen <= drawLen) lo = mid;
			else hi = mid - 1;
		}
		const lastIdx = lo;
		let tailX = 0;
		let tailY = 0;
		let tailWidth = 0;
		let tailIdx = 0;
		let tailCumLen = 0;
		let hasTail = false;
		if (lastIdx + 1 < vertices.length && drawLen > vertices[lastIdx].cumLen) {
			const a = vertices[lastIdx];
			const b = vertices[lastIdx + 1];
			const segLen = b.cumLen - a.cumLen;
			const t = segLen > 0 ? (drawLen - a.cumLen) / segLen : 0;
			tailX = a.x + (b.x - a.x) * t;
			tailY = a.y + (b.y - a.y) * t;
			tailWidth = a.width + (b.width - a.width) * t;
			tailIdx = a.idx + (b.idx - a.idx) * t;
			tailCumLen = drawLen;
			hasTail = true;
		}
		const tcount = lastIdx + 1 + (hasTail ? 1 : 0);
		const txs = new Array(tcount);
		const tys = new Array(tcount);
		for (let i = 0; i <= lastIdx; i++) {
			const v = vertices[i];
			txs[i] = px(v.x + wobbleDx(v.x, v.y, v.idx));
			tys[i] = py(v.y + wobbleDy(v.x, v.y, v.idx));
		}
		if (hasTail) {
			txs[tcount - 1] = px(tailX + wobbleDx(tailX, tailY, tailIdx));
			tys[tcount - 1] = py(tailY + wobbleDy(tailX, tailY, tailIdx));
		}
		ctx.lineCap = lineCap;
		ctx.lineJoin = "round";
		const tracePolyline = () => {
			ctx.beginPath();
			ctx.moveTo(txs[0], tys[0]);
			for (let i = 1; i < tcount; i++) ctx.lineTo(txs[i], tys[i]);
		};
		for (const glow of glowEffects) {
			ctx.save();
			ctx.shadowBlur = resolveCSSLength(glow.config.radius ?? 8, pos.fontSize);
			ctx.shadowColor = glow.config.color ?? color;
			ctx.shadowOffsetX = (glow.config.offsetX ?? 0) * scale;
			ctx.shadowOffsetY = (glow.config.offsetY ?? 0) * scale;
			ctx.strokeStyle = glow.config.color ?? color;
			ctx.lineWidth = baseLineWidth;
			tracePolyline();
			ctx.stroke();
			ctx.restore();
		}
		if (!needsPerSegment && !hasStrokeGradient) {
			ctx.strokeStyle = defaultStrokePaint;
			ctx.lineWidth = baseLineWidth;
			tracePolyline();
			ctx.stroke();
		} else {
			const invTotalLen = 1 / totalLen;
			for (let i = 1; i < tcount; i++) {
				const aCum = i - 1 <= lastIdx ? vertices[i - 1].cumLen : tailCumLen;
				const bCum = i <= lastIdx ? vertices[i].cumLen : tailCumLen;
				const aWidth = i - 1 <= lastIdx ? vertices[i - 1].width : tailWidth;
				const bWidth = i <= lastIdx ? vertices[i].width : tailWidth;
				const midProgress = (aCum + bCum) * .5 * invTotalLen;
				let lw = baseLineWidth;
				if (needsPerSegment) {
					const perPoint = (aWidth + bWidth) * .5 * scale * strokeScale;
					lw = Math.max(baseLineWidth + (perPoint - baseLineWidth) * pressureAmount, .5 * scale * strokeScale) * taperMultiplier(midProgress);
				}
				ctx.lineWidth = lw;
				ctx.strokeStyle = hasStrokeGradient ? colorAt(midProgress) : defaultStrokePaint;
				ctx.beginPath();
				ctx.moveTo(txs[i - 1], tys[i - 1]);
				ctx.lineTo(txs[i], tys[i]);
				ctx.stroke();
			}
		}
	}
}
//#endregion
//#region src/lib/features.ts
/**
* Features that harfbuzz's (and the browser's) complex-text shapers apply
* context-sensitively based on the script. Passing them in an explicit
* "enable" list tells the shaper to apply them unconditionally to the whole
* text range, which breaks the positional assignment — e.g. every Arabic
* glyph collapses to the final form.
*
* Trust the shaper's script defaults for these and never emit them as
* explicit enables. (Explicit *disables* are fine — `-fina` suppressing the
* automatic fina is exactly the user's intent.)
*/
const SHAPER_MANAGED_FEATURES = /* @__PURE__ */ new Set([
	"init",
	"medi",
	"fina",
	"isol",
	"rlig"
]);
/**
* Build a CSS `font-feature-settings` value from bundle features. Same
* filter as the HB path: shaper-managed tags are omitted so browsers keep
* their contextual positional assignment.
*
* Fonts with no declared features fall back to disabling `liga` + `calt`,
* which matches the legacy "1:1 char-to-glyph" assumption the renderer
* makes when it can't shape.
*/
function toCssFeatureSettings(enabled) {
	if (enabled.length === 0) return "'calt' 0, 'liga' 0";
	const explicit = enabled.filter((tag) => !SHAPER_MANAGED_FEATURES.has(tag));
	if (explicit.length === 0) return "normal";
	return explicit.map((f) => `'${f}' 1`).join(", ");
}
//#endregion
//#region src/lib/font.ts
const fontFaceCache = /* @__PURE__ */ new Map();
const resolvedUrls = /* @__PURE__ */ new Set();
/**
* Ensures the bundle's font face is loaded and available for rendering.
* Resolves immediately if the font is already loaded.
*/
async function ensureFontFace(bundle) {
	await ensureFont(bundle.family, bundle.fontUrl, bundle.features, bundle.extraFontUrls);
}
function ensureFont(family, url, features, extraFontUrls) {
	if (typeof document === "undefined") return Promise.resolve();
	const urls = [url, ...extraFontUrls ?? []];
	if (urls.every((u) => resolvedUrls.has(u))) return null;
	const featureSettings = toCssFeatureSettings(features ?? []);
	const pending = urls.map((u) => {
		let cached = fontFaceCache.get(u);
		if (!cached) {
			cached = new FontFace(family, `url(${u})`, { featureSettings }).load().then((loaded) => {
				document.fonts.add(loaded);
				resolvedUrls.add(u);
			});
			fontFaceCache.set(u, cached);
		}
		return cached;
	});
	return Promise.all(pending).then(() => {});
}
//#endregion
//#region src/lib/textLayout.ts
const RTL_CHAR_RE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
/**
* Compute the text bounding box from a measured layout. Inputs are in CSS
* pixels. Assumes the layout's char offsets are em-relative to the left edge
* of each line (as produced by `computeTextLayout`).
*/
function computeLayoutBbox(layout, fontSize, lineHeight) {
	let maxRight = 0;
	for (const lineIndices of layout.lines) for (const charIdx of lineIndices) {
		const right = ((layout.charOffsets[charIdx] ?? 0) + (layout.charWidths[charIdx] ?? 0)) * fontSize;
		if (right > maxRight) maxRight = right;
	}
	return {
		x: 0,
		y: 0,
		width: maxRight,
		height: layout.lines.length * lineHeight
	};
}
function computeTextLayout(elOrText, fontSize, fontFamily, lineHeight, maxWidth) {
	if (typeof elOrText === "string") return measureWithTempElement(elOrText, fontFamily, fontSize, lineHeight, maxWidth);
	return measureElement(elOrText, fontSize);
}
function measureElement(el, fontSize) {
	const textNode = el.firstChild;
	if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return {
		lines: [],
		charOffsets: [],
		charWidths: []
	};
	const chars = graphemes(textNode.textContent ?? "");
	if (!chars.length) return {
		lines: [],
		charOffsets: [],
		charWidths: []
	};
	const elRect = el.getBoundingClientRect();
	const elLeft = elRect.left;
	const scale = el.offsetWidth > 0 ? elRect.width / el.offsetWidth : 1;
	const range = document.createRange();
	const charOffsets = [];
	const charWidths = [];
	const lines = [];
	let currentLine = [];
	let prevTop = -Infinity;
	let utf16Offset = 0;
	for (let i = 0; i < chars.length; i++) {
		const char = chars[i];
		if (char === "\n") {
			charOffsets.push(0);
			charWidths.push(0);
			currentLine.push(i);
			lines.push(currentLine);
			currentLine = [];
			prevTop = -Infinity;
			utf16Offset += char.length;
			continue;
		}
		range.setStart(textNode, utf16Offset);
		range.setEnd(textNode, utf16Offset + char.length);
		const rects = range.getClientRects();
		utf16Offset += char.length;
		if (rects.length === 0) {
			charOffsets.push(0);
			charWidths.push(0);
			currentLine.push(i);
			continue;
		}
		const rect = rects[rects.length - 1];
		if (currentLine.length > 0 && rect.top - prevTop > fontSize * .25 * scale) {
			lines.push(currentLine);
			currentLine = [];
		}
		if (currentLine.length === 0) prevTop = rect.top;
		charOffsets.push((rect.left - elLeft) / scale / fontSize);
		charWidths.push(rect.width / scale / fontSize);
		currentLine.push(i);
	}
	if (currentLine.length > 0) lines.push(currentLine);
	return {
		lines,
		charOffsets,
		charWidths
	};
}
/**
* Replace `layout.charOffsets` and `charWidths` with values computed from the
* shaper's advances, while preserving the DOM's line-break decisions. When a
* `timeline` is provided, each entry's `xOffsetEm` and `yOffsetEm` are also
* filled in from the shaper's per-glyph pen-walk (mutated in place) and
* `layout.lineLefts` is populated — together they let the engine draw each
* glyph at its GPOS-positioned origin (cursive-attachment lift, mark
* attachment) instead of sharing one position per cluster.
*
* The DOM's Range API returns imprecise per-grapheme rects inside a complex-
* shaped cluster (Arabic joining, Indic conjuncts, ligatures with kern/mark
* GPOS), so strokes positioned from `rect.left` drift relative to the actual
* glyph origins the shaper produced. Using the shaper's own `ax` walk keeps
* the stroke positions aligned with the glyph ids the shaper chose.
*
* Line anchor (the leftmost visual pixel of each line) is measured from the
* DOM using a full-line Range — per-grapheme rects inside shaped clusters are
* not reliable enough to anchor against.
*/
function applyShaperPositions(layout, el, text, fontSize, font, shaper, timeline) {
	const chars = graphemes(text);
	if (!chars.length) return layout;
	const textNode = el.firstChild;
	if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return layout;
	const elRect = el.getBoundingClientRect();
	const elLeft = elRect.left;
	const scale = el.offsetWidth > 0 ? elRect.width / el.offsetWidth : 1;
	const range = document.createRange();
	const graphemeStartU = [];
	{
		let u = 0;
		for (let i = 0; i < chars.length; i++) {
			graphemeStartU.push(u);
			u += chars[i].length;
		}
	}
	const utf16ToGrapheme = new Int32Array(text.length + 1).fill(-1);
	for (let i = 0; i < chars.length; i++) utf16ToGrapheme[graphemeStartU[i]] = i;
	utf16ToGrapheme[text.length] = chars.length;
	const charOffsets = layout.charOffsets.slice();
	const charWidths = layout.charWidths.slice();
	const lineLefts = new Array(layout.lines.length).fill(0);
	const emPerUnit = 1 / font.unitsPerEm;
	const entryQueue = /* @__PURE__ */ new Map();
	if (timeline) for (let ei = 0; ei < timeline.entries.length; ei++) {
		const e = timeline.entries[ei];
		if (e.glyphId === void 0) continue;
		const key = `${e.graphemeIndex}:${e.glyphId}`;
		const list = entryQueue.get(key);
		if (list) list.push(ei);
		else entryQueue.set(key, [ei]);
	}
	for (let li = 0; li < layout.lines.length; li++) {
		const realIndices = layout.lines[li].filter((idx) => chars[idx] !== "\n");
		if (realIndices.length === 0) continue;
		const lineStartU = graphemeStartU[realIndices[0]];
		const lastReal = realIndices[realIndices.length - 1];
		const lineEndU = graphemeStartU[lastReal] + chars[lastReal].length;
		range.setStart(textNode, lineStartU);
		range.setEnd(textNode, lineEndU);
		const lineRects = range.getClientRects();
		if (lineRects.length === 0) continue;
		let lineLeftPx = Infinity;
		for (const r of lineRects) if (r.left < lineLeftPx) lineLeftPx = r.left;
		const lineLeftEm = (lineLeftPx - elLeft) / scale / fontSize;
		lineLefts[li] = lineLeftEm;
		const lineText = text.slice(lineStartU, lineEndU);
		const lineRTL = RTL_CHAR_RE.test(lineText);
		const shaped = shaper.shape(lineText);
		if (shaped.length === 0) continue;
		const visualGlyphs = lineRTL ? reverseRTLRuns(shaped) : shaped;
		const clusterLeft = /* @__PURE__ */ new Map();
		const clusterAdvance = /* @__PURE__ */ new Map();
		let penEm = 0;
		let penYEm = 0;
		for (const g of visualGlyphs) {
			const axEm = g.ax * emPerUnit;
			const ayEm = g.ay * emPerUnit;
			const dxEm = g.dx * emPerUnit;
			const dyEm = g.dy * emPerUnit;
			const glyphXEm = penEm + dxEm;
			const glyphYEm = penYEm - dyEm;
			if (!clusterLeft.has(g.cl)) clusterLeft.set(g.cl, glyphXEm);
			clusterAdvance.set(g.cl, (clusterAdvance.get(g.cl) ?? 0) + axEm);
			if (timeline) {
				const gIdx = utf16ToGrapheme[lineStartU + g.cl];
				if (gIdx !== void 0 && gIdx >= 0) {
					const ei = entryQueue.get(`${gIdx}:${g.g}`)?.shift();
					if (ei !== void 0) {
						const entry = timeline.entries[ei];
						entry.xOffsetEm = glyphXEm;
						entry.yOffsetEm = glyphYEm;
					}
				}
			}
			penEm += axEm;
			penYEm -= ayEm;
		}
		const assigned = /* @__PURE__ */ new Set();
		for (const [cl, leftEm] of clusterLeft) {
			const gIdx = utf16ToGrapheme[lineStartU + cl];
			if (gIdx === void 0 || gIdx < 0) continue;
			charOffsets[gIdx] = lineLeftEm + leftEm;
			charWidths[gIdx] = clusterAdvance.get(cl) ?? 0;
			assigned.add(gIdx);
		}
		const sortedCls = [...clusterLeft.keys()].sort((a, b) => a - b);
		for (const idx of realIndices) {
			if (assigned.has(idx)) continue;
			const u = graphemeStartU[idx] - lineStartU;
			let hostCl = -1;
			for (const cl of sortedCls) if (cl <= u) hostCl = cl;
			else break;
			if (hostCl < 0) continue;
			charOffsets[idx] = lineLeftEm + (clusterLeft.get(hostCl) ?? 0);
			charWidths[idx] = 0;
		}
	}
	return {
		lines: layout.lines,
		charOffsets,
		charWidths,
		lineLefts
	};
}
/**
* Reorder a harfbuzz-shaped RTL line so that pen-walking forward produces
* visual left-to-right positions. HB emits each word's glyphs in within-word
* visual order (cl descending for RTL) but keeps the words themselves in
* logical order — so we split on cl-jumps and reverse the list of runs while
* preserving each run's internal order.
*/
function reverseRTLRuns(shaped) {
	const runs = [];
	let cur = [];
	for (const g of shaped) {
		if (cur.length && g.cl > cur[cur.length - 1].cl) {
			runs.push(cur);
			cur = [];
		}
		cur.push(g);
	}
	if (cur.length) runs.push(cur);
	const out = [];
	for (let i = runs.length - 1; i >= 0; i--) out.push(...runs[i]);
	return out;
}
function measureWithTempElement(text, fontFamily, fontSize, lineHeight, maxWidth) {
	const el = document.createElement("div");
	el.style.position = "absolute";
	el.style.left = "-9999px";
	el.style.top = "-9999px";
	el.style.visibility = "hidden";
	el.style.fontFamily = fontFamily;
	el.style.fontSize = `${fontSize}px`;
	el.style.lineHeight = `${lineHeight}px`;
	el.style.whiteSpace = "pre-wrap";
	el.style.overflowWrap = "break-word";
	el.style.width = `${maxWidth}px`;
	el.textContent = text;
	document.body.appendChild(el);
	const result = measureElement(el, fontSize);
	document.body.removeChild(el);
	return result;
}
//#endregion
//#region src/types.ts
/**
* Current bundle format version. Incremented when the bundle format changes
* in a way that older engines cannot consume.
*/
const BUNDLE_VERSION = 0;
/**
* Set of bundle versions that this engine can consume. The engine logs a
* console warning (once per bundle) when it encounters a version outside
* this set.
*/
const COMPATIBLE_BUNDLE_VERSIONS = /* @__PURE__ */ new Set([0]);
//#endregion
//#region src/core/bundle-registry.ts
const bundles = /* @__PURE__ */ new Map();
const warnedBundles = /* @__PURE__ */ new Set();
function checkBundleVersion(bundle) {
	if (warnedBundles.has(bundle)) return;
	if (bundle.version == null || !COMPATIBLE_BUNDLE_VERSIONS.has(bundle.version)) {
		warnedBundles.add(bundle);
		console.warn(`[tegaki] Bundle "${bundle.family}" has version ${bundle.version ?? "undefined"}, but this engine supports versions [${[...COMPATIBLE_BUNDLE_VERSIONS].join(", ")}]. The bundle may not render correctly. Regenerate it with a compatible version of tegaki-generator.`);
	}
}
/** Register a font bundle so it can be referenced by family name. */
function registerBundle(bundle) {
	checkBundleVersion(bundle);
	bundles.set(bundle.family, bundle);
	if (bundle.fullFamily && bundle.fullFamily !== bundle.family) bundles.set(bundle.fullFamily, bundle);
}
/** Look up a registered bundle by family name. */
function getBundle(family) {
	return bundles.get(family);
}
function resolveBundle(font) {
	if (typeof font === "string") {
		const bundle = getBundle(font);
		if (!bundle) throw new Error(`TegakiEngine: no bundle registered for "${font}". Call TegakiEngine.registerBundle() first.`);
		return bundle;
	}
	if (font) checkBundleVersion(font);
	return font;
}
//#endregion
//#region src/core/createBundle.ts
/**
* Creates a {@link TegakiBundle} from its constituent parts.
*
* Useful when loading font data from a CDN or other source where the
* pre-built bundle modules aren't available:
*
* ```js
* const glyphData = await fetch('.../glyphData.json').then(r => r.json());
* const bundle = createBundle({
*   family: 'Caveat',
*   fontUrl: '.../caveat.ttf',
*   glyphData,
* });
* ```
*/
function createBundle({ family, fullFamily, fontUrl, fullFontUrl, glyphData, lineCap = "round", unitsPerEm = 1e3, ascender = 800, descender = -200 }) {
	const rules = [`@font-face { font-family: '${family}'; src: url(${fontUrl}); }`];
	if (fullFamily && fullFontUrl) rules.push(`@font-face { font-family: '${fullFamily}'; src: url(${fullFontUrl}); }`);
	return {
		version: 0,
		family,
		fullFamily,
		lineCap,
		fontUrl,
		fullFontUrl,
		fontFaceCSS: rules.join(" "),
		unitsPerEm,
		ascender,
		descender,
		glyphData
	};
}
//#endregion
//#region src/lib/drawFallbackGlyph.ts
/**
* Draw a fallback glyph (plain text) with applicable effects (glow, strokeGradient, wobble).
*/
function drawFallbackGlyph(ctx, char, x, baseline, fontSize, fontFamily, color, effects = [], seed = 0) {
	const glowEffects = findEffects(effects, "glow");
	const wobbleEffect = findEffect(effects, "wobble");
	const strokeGradientEffect = findEffect(effects, "strokeGradient");
	let dx = 0;
	let dy = 0;
	if (wobbleEffect) {
		const amplitude = (wobbleEffect.config.amplitude ?? 1.5) * (fontSize / 100);
		const frequency = wobbleEffect.config.frequency ?? 8;
		dx = amplitude * Math.sin(frequency * (baseline * .01) + seed);
		dy = amplitude * Math.cos(frequency * (x * .01) + seed * 1.3);
	}
	const drawX = x + dx;
	const drawY = baseline + dy;
	let fillColor = color;
	if (strokeGradientEffect) {
		const colors = strokeGradientEffect.config.colors;
		if (colors === "rainbow") {
			const saturation = strokeGradientEffect.config.saturation ?? 80;
			const lightness = strokeGradientEffect.config.lightness ?? 55;
			fillColor = `hsl(${seed * 137.5 % 360}, ${saturation}%, ${lightness}%)`;
		} else if (Array.isArray(colors) && colors.length > 0) fillColor = colors[Math.floor(seed) % colors.length];
	}
	ctx.save();
	ctx.font = `${fontSize}px ${fontFamily}`;
	ctx.textBaseline = "alphabetic";
	for (const glow of glowEffects) {
		ctx.save();
		ctx.shadowBlur = resolveCSSLength(glow.config.radius ?? 8, fontSize);
		ctx.shadowColor = glow.config.color ?? color;
		ctx.shadowOffsetX = glow.config.offsetX ?? 0;
		ctx.shadowOffsetY = glow.config.offsetY ?? 0;
		ctx.fillStyle = glow.config.color ?? color;
		ctx.fillText(char, drawX, drawY);
		ctx.restore();
	}
	ctx.fillStyle = fillColor;
	ctx.fillText(char, drawX, drawY);
	ctx.restore();
}
//#endregion
//#region src/core/render-elements.ts
const PAD_V_CSS = "max(0.2em, 0.9em - 0.5lh)";
function buildRootProps(options) {
	const text = options.text ?? "";
	const font = resolveBundle(options.font);
	const fontFamily = font ? cssFontFamily(font) : void 0;
	const duration = text && font ? computeTimeline(text, font, options.timing).totalDuration : 0;
	const timeObj = typeof options.time === "object" ? options.time : null;
	const rawTime = typeof options.time === "number" ? options.time : timeObj?.mode === "controlled" ? timeObj.unit === "progress" ? timeObj.value * duration : timeObj.value : timeObj?.mode === "uncontrolled" ? timeObj.initialTime ?? 0 : 0;
	const easing = timeObj?.mode === "uncontrolled" ? timeObj.easing : void 0;
	const time = easing && duration > 0 ? easing(rawTime / duration) * duration : rawTime;
	const progress = duration > 0 ? time / duration : 0;
	return {
		"data-tegaki": "root",
		dir: options?.direction ?? "auto",
		style: {
			position: "relative",
			maxWidth: "100%",
			width: "auto",
			height: "auto",
			fontFamily,
			direction: options.direction ?? void 0,
			[CSS_DURATION]: duration,
			[CSS_TIME]: time,
			[CSS_PROGRESS]: progress
		}
	};
}
function buildChildren(options, h) {
	const text = options.text ?? "";
	const isCss = options.time === "css" || typeof options.time === "object" && options.time?.mode === "css";
	const showOverlay = options.showOverlay;
	return h("span", { style: {
		display: "block",
		position: "relative"
	} }, h("span", {
		"data-tegaki": "sentinel",
		"aria-hidden": "true",
		style: {
			position: "absolute",
			width: 0,
			overflow: "hidden",
			pointerEvents: "none",
			fontSize: "inherit",
			lineHeight: "inherit",
			visibility: "hidden",
			transition: isCss ? `font-size 0.001s, line-height 0.001s, color 0.001s, ${CSS_PROGRESS} 0.001s` : "font-size 0.001s, line-height 0.001s, color 0.001s"
		}
	}), h("canvas", {
		"data-tegaki": "canvas",
		"aria-hidden": "true",
		style: {
			position: "absolute",
			top: `calc(-1 * ${PAD_V_CSS})`,
			right: "-0.2em",
			bottom: `calc(-1 * ${PAD_V_CSS})`,
			left: "-0.2em",
			width: "calc(100% + 0.4em)",
			height: `calc(100% + 2 * ${PAD_V_CSS})`,
			pointerEvents: "none",
			overflow: "visible"
		}
	}, h("span", {
		"data-tegaki": "canvas-fallback",
		style: {
			display: "inline-block",
			padding: `${PAD_V_CSS} 0.2em`
		}
	}, text)), h("span", {
		"data-tegaki": "overlay",
		style: {
			display: "block",
			userSelect: "auto",
			whiteSpace: "pre-wrap",
			overflowWrap: "break-word",
			paddingInlineEnd: 1,
			textRendering: "geometricPrecision",
			WebkitTextFillColor: showOverlay ? void 0 : "transparent",
			color: showOverlay ? "rgba(255, 0, 0, 0.4)" : void 0
		}
	}, text));
}
function domCreateElement(tag, props, ...children) {
	const el = document.createElement(tag);
	for (const [key, value] of Object.entries(props)) if (key === "style" && typeof value === "object") {
		for (const [k, v] of Object.entries(value)) if (v !== void 0 && v !== null) if (k.startsWith("--")) el.style.setProperty(k, String(v));
		else el.style[k] = typeof v === "number" && k !== "opacity" && k !== "zIndex" ? `${v}px` : v;
	} else if (key === "aria-hidden") el.setAttribute("aria-hidden", String(value));
	else if (key.startsWith("data-")) el.setAttribute(key, String(value));
	for (const child of children) if (typeof child === "string") el.appendChild(document.createTextNode(child));
	else el.appendChild(child);
	return el;
}
//#endregion
//#region src/core/shaper-registry.ts
let factory = null;
const shaperCache = /* @__PURE__ */ new Map();
/**
* Register a shaper factory. Shaping is opt-in — without a registered factory,
* the renderer iterates raw graphemes and uses the bundle's char-keyed
* `glyphData` map. Use `tegaki/shaper-harfbuzz` for fonts that need complex
* shaping (ligatures, contextual forms, Arabic/Indic scripts).
*
* Re-registering replaces the previous factory and invalidates the shaper
* cache. Pass `null` to unregister.
*/
function registerShaper(f) {
	factory = f;
	shaperCache.clear();
}
/**
* Build (or reuse) a shaper for a bundle. Returns `null` when no factory is
* registered or the factory declined this bundle.
*/
function getShaperForBundle(bundle) {
	if (!factory) return null;
	const key = bundle.fontUrl;
	let entry = shaperCache.get(key);
	if (!entry) {
		const result = factory(bundle);
		if (!result) return null;
		shaperCache.set(key, result);
		entry = result;
	}
	return entry;
}
//#endregion
//#region src/core/engine.ts
/**
* Parse a percentage string like `"50%"` into a 0–1 fraction. Returns `null`
* for non-percentage strings or unparseable input. Whitespace around the
* value is tolerated; the numeric part is parsed with `Number(...)`, so any
* finite numeric form (including negatives and decimals) is accepted.
*/
function parsePercentage(s) {
	const trimmed = s.trim();
	if (!trimmed.endsWith("%")) return null;
	const num = Number(trimmed.slice(0, -1));
	return Number.isFinite(num) ? num / 100 : null;
}
function resolveTimeControl(prop) {
	if (prop == null) return { mode: "uncontrolled" };
	if (typeof prop === "number") return {
		mode: "controlled",
		value: prop
	};
	if (typeof prop === "string") {
		if (prop === "css") return { mode: "css" };
		const pct = parsePercentage(prop);
		if (pct != null) return {
			mode: "controlled",
			value: pct,
			unit: "progress"
		};
		return { mode: "uncontrolled" };
	}
	return prop;
}
var TegakiEngine = class {
	/** Register a font bundle so it can be referenced by family name. */
	static registerBundle = registerBundle;
	/** Look up a registered bundle by family name. */
	static getBundle = getBundle;
	/**
	* Register a shaper factory. Shaping is opt-in — without a registered
	* factory, the renderer iterates raw graphemes and uses the bundle's
	* char-keyed `glyphData` map. Pass the `harfbuzzShaper` export from
	* `tegaki/shaper-harfbuzz` for fonts that need complex shaping.
	*
	* Re-registering replaces the previous factory and invalidates the cache.
	* Pass `null` to unregister.
	*/
	static registerShaper = registerShaper;
	_rootEl;
	_contentEl = null;
	_sentinelEl;
	_canvasEl;
	_overlayEl;
	_canvasFallbackEl;
	_maskCanvas = null;
	_text = "";
	_font = null;
	_timeControl = { mode: "uncontrolled" };
	_effects;
	_timing;
	_quality;
	_showOverlay = false;
	_onComplete;
	_onChangeTimeline;
	_direction;
	_resolvedEffects = resolveEffects(void 0);
	_seed;
	_timeline = {
		entries: [],
		totalDuration: 0
	};
	_layout = null;
	_layoutKey = "";
	_fontReady = false;
	_shaper = null;
	_shaperReady = true;
	_shaperEnabled = true;
	_strokeCache = /* @__PURE__ */ new WeakMap();
	_strokeCacheKey = "";
	_containerWidth = 0;
	_fontSize = 0;
	_lineHeight = 0;
	_currentColor = "";
	_internalTime = 0;
	_cssTime = 0;
	_playing = true;
	_smoothedBoost = 0;
	_delayRemaining = 0;
	_loopGapRemaining = 0;
	_lastTs = null;
	_rafId = 0;
	_prevCompleted = false;
	_prefersReducedMotion = false;
	_destroyed = false;
	_resizeObserver;
	_mql = null;
	/**
	* Returns the props (including style) that should be applied to the container element,
	* plus the inner content tree rendered via a framework `createElement` callback.
	*
	* Each child element receives a `data-tegaki` attribute so the engine can adopt
	* pre-rendered elements later via `new TegakiEngine(container, { adopt: true })`.
	*/
	static renderElements(options, createElement) {
		return {
			rootProps: buildRootProps(options),
			content: buildChildren(options, createElement)
		};
	}
	constructor(container, options) {
		registerCssProperties();
		this._seed = Math.random() * 1e3;
		this._rootEl = container;
		if (options?.adopt) {} else {
			const content = buildChildren(options ?? {}, domCreateElement);
			container.appendChild(content);
			this._contentEl = content;
			const rootProps = buildRootProps(options ?? {});
			for (const [key, value] of Object.entries(rootProps.style)) if (value !== void 0 && value !== null) if (key.startsWith("--")) container.style.setProperty(key, String(value));
			else container.style[key] = typeof value === "number" && key !== "opacity" && key !== "zIndex" ? `${value}px` : value;
			container.dataset.tegaki = "root";
			container.dir = options?.direction ?? "auto";
		}
		this._sentinelEl = container.querySelector("[data-tegaki=\"sentinel\"]");
		this._canvasEl = container.querySelector("[data-tegaki=\"canvas\"]");
		this._canvasFallbackEl = container.querySelector("[data-tegaki=\"canvas-fallback\"]");
		this._overlayEl = container.querySelector("[data-tegaki=\"overlay\"]");
		this._resizeObserver = new ResizeObserver(this._onResize);
		this._resizeObserver.observe(this._rootEl);
		this._sentinelEl.addEventListener("transitionend", this._onSentinelTransition);
		if (typeof window !== "undefined") {
			this._mql = window.matchMedia("(prefers-reduced-motion: reduce)");
			this._prefersReducedMotion = this._mql.matches;
			if (this._mql.addEventListener) this._mql.addEventListener("change", this._onReducedMotionChange);
			else this._mql.addListener(this._onReducedMotionChange);
		}
		this._measure();
		if (options) this.update(options);
	}
	get currentTime() {
		const tc = this._timeControl;
		if (tc.mode === "css") return this._cssTime;
		if (tc.mode === "controlled") return tc.unit === "progress" ? tc.value * this._timeline.totalDuration : tc.value;
		const totalDur = this._timeline.totalDuration;
		if (tc.easing && totalDur > 0) return tc.easing(this._internalTime / totalDur) * totalDur;
		return this._internalTime;
	}
	get duration() {
		return this._timeline.totalDuration;
	}
	/**
	* The engine's current timeline — the same object that drives rendering.
	* Reflects the resolved shaper once the (async) shaper promise has
	* settled; use the `onChangeTimeline` option to be notified of recomputations.
	* Treat the returned object as read-only.
	*/
	get timeline() {
		return this._timeline;
	}
	/**
	* Compute a timeline for arbitrary text against this engine's currently-
	* loaded font, timing config, and resolved shaper. Useful for measuring
	* the duration of hypothetical text without changing what's rendered
	* (e.g. layout planning, fade-in scheduling).
	*
	* Returns an empty timeline when no font is loaded. The result reflects
	* shaper state at call time — call after `onChangeTimeline` has fired
	* once to be sure the shaper has resolved.
	*/
	computeTimeline(text) {
		if (!this._font) return {
			entries: [],
			totalDuration: 0
		};
		return computeTimeline(text, this._font, this._timing, this._shaper);
	}
	get isPlaying() {
		return this._playing;
	}
	get isComplete() {
		const totalDur = this._timeline.totalDuration;
		if (totalDur === 0) return false;
		if (this._timeControl.mode === "uncontrolled") return this._internalTime >= totalDur;
		return this.currentTime >= totalDur;
	}
	get element() {
		return this._rootEl;
	}
	/**
	* The backing `<canvas>` strokes are drawn onto. Exposed so export tooling
	* can snapshot the current frame (PNG) or sample it over time (WebM/GIF)
	* without reaching through the DOM. Reflects the latest `_render()`.
	*/
	get canvas() {
		return this._canvasEl;
	}
	/**
	* Serialize the current text to an SVG string, reusing the engine's measured
	* layout and timeline so glyph positions match the canvas render exactly.
	*
	* `animated: true` (default) emits a self-drawing SVG — each stroke is
	* revealed through a dashed-centerline mask over its own timeline window, so
	* the file draws itself when opened. `animated: false` emits the finished
	* artwork (every stroke fully drawn).
	*
	* `loop: true` emits a looping CSS-keyframe animation (constant width) that
	* draws, holds, fades, and repeats forever — reliable in `<img>`-embedded
	* SVGs (e.g. a README hero). Implies `animated`.
	*
	* Variable stroke width (pressureWidth) is honoured in single-play mode (not
	* `loop`). Glow, wobble, gradient, taper, and clip-to-text are not modelled
	* in the SVG output.
	*/
	toSVG(opts = {}) {
		const font = this._font;
		const layout = this._layout;
		const fontSize = this._fontSize;
		const canvas = this._canvasEl;
		const width = canvas.offsetWidth;
		const height = canvas.offsetHeight;
		if (!font?.glyphData || !layout || !fontSize) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"></svg>`;
		const padH = PADDING_H_EM * fontSize;
		const lineHeight = this._lineHeight;
		const padV = Math.max(MIN_PADDING_V_EM * fontSize, (MIN_LINE_HEIGHT_EM * fontSize - lineHeight) / 2);
		const halfLeading = (lineHeight - (font.ascender - font.descender) / font.unitsPerEm * fontSize) / 2;
		const scale = fontSize / font.unitsPerEm;
		const characters = graphemes(this._text);
		const pressureEffect = findEffect(this._resolvedEffects, "pressureWidth");
		const pressure = pressureEffect ? Math.max(0, Math.min(pressureEffect.config.strength ?? 1, 1)) : 0;
		const smoothing = this._quality?.smoothing === true;
		const resolvedSegmentSize = this._quality?.segmentSize ?? (pressure > 0 || smoothing ? 2 : void 0);
		const segmentLengthFU = resolvedSegmentSize != null ? resolvedSegmentSize / scale : Infinity;
		const clipText = this._quality?.clipText;
		const strokeScale = typeof clipText === "number" ? clipText : 1;
		const graphemeToLine = new Int32Array(characters.length).fill(-1);
		for (let li = 0; li < layout.lines.length; li++) for (const charIdx of layout.lines[li]) graphemeToLine[charIdx] = li;
		const placements = [];
		for (const entry of this._timeline.entries) {
			if (entry.char === "\n" || !entry.hasGlyph) continue;
			const charIdx = entry.graphemeIndex;
			const lineIdx = graphemeToLine[charIdx] ?? -1;
			if (lineIdx < 0) continue;
			const glyph = (entry.glyphId !== void 0 ? font.glyphDataById?.[entry.glyphId] : void 0) ?? lookupGlyphData(font, entry.char);
			if (!glyph) continue;
			const y = lineIdx * lineHeight;
			const lineLeftEm = layout.lineLefts?.[lineIdx];
			const x = entry.xOffsetEm !== void 0 && lineLeftEm !== void 0 ? (lineLeftEm + entry.xOffsetEm) * fontSize : (layout.charOffsets[charIdx] ?? 0) * fontSize;
			const glyphY = y + halfLeading + (entry.yOffsetEm ?? 0) * fontSize;
			placements.push({
				glyph,
				ox: padH + x,
				oy: padV + glyphY,
				scale,
				ascender: font.ascender,
				offset: entry.offset
			});
		}
		return placementsToSvg(placements, {
			width,
			height,
			lineCap: font.lineCap,
			color: this._currentColor || "black",
			pressure,
			segmentLengthFU,
			smoothing,
			strokeScale,
			animated: opts.animated ?? true,
			loop: opts.loop ?? false,
			totalDuration: this._timeline.totalDuration
		});
	}
	play() {
		if (this._timeControl.mode !== "uncontrolled") return;
		this._playing = true;
		this._evaluatePlayback();
	}
	pause() {
		if (this._timeControl.mode !== "uncontrolled") return;
		this._playing = false;
		this._evaluatePlayback();
	}
	/**
	* Seek the (uncontrolled) timeline to an absolute time. Accepts seconds
	* (number) or a percentage string like `"50%"`, which is interpreted as
	* a fraction of the timeline's total duration.
	*/
	seek(time) {
		if (this._timeControl.mode !== "uncontrolled") return;
		let resolved;
		if (typeof time === "string") {
			const pct = parsePercentage(time);
			if (pct == null) return;
			resolved = pct * this._timeline.totalDuration;
		} else resolved = time;
		this._internalTime = Math.max(0, Math.min(resolved, this._timeline.totalDuration));
		this._delayRemaining = 0;
		this._loopGapRemaining = 0;
		this._checkCompletion();
		this._notifyTimeChange();
		this._render();
		this._updateCssProperties();
	}
	restart() {
		if (this._timeControl.mode !== "uncontrolled") return;
		this._internalTime = 0;
		this._playing = true;
		this._prevCompleted = false;
		this._delayRemaining = this._timeControl.delay ?? 0;
		this._loopGapRemaining = 0;
		this._notifyTimeChange();
		this._evaluatePlayback();
	}
	update(options) {
		if (this._destroyed) return;
		let dirtyTimeline = false;
		let dirtyLayout = false;
		let dirtyRender = false;
		let dirtyPlayback = false;
		if ("text" in options) {
			const nextText = (options.text ?? "").replace(/\r\n?/g, "\n").normalize("NFC");
			if (nextText !== this._text) {
				this._text = nextText;
				dirtyTimeline = true;
				dirtyLayout = true;
			}
		}
		if ("shaper" in options) {
			const next = options.shaper !== false;
			if (next !== this._shaperEnabled) {
				this._shaperEnabled = next;
				this._loadShaper();
				this._updateOverlayStyle();
				dirtyTimeline = true;
				dirtyLayout = true;
				dirtyPlayback = true;
				dirtyRender = true;
			}
		}
		if ("font" in options) {
			const resolved = resolveBundle(options.font) ?? null;
			if (resolved !== this._font) {
				this._loadFont(resolved);
				dirtyTimeline = true;
				dirtyLayout = true;
				dirtyPlayback = true;
			}
		}
		if ("time" in options) {
			const newTc = resolveTimeControl(options.time);
			const oldTc = this._timeControl;
			const modeChanged = newTc.mode !== oldTc.mode;
			const controlledValueChanged = newTc.mode === "controlled" && oldTc.mode === "controlled" && (newTc.value !== oldTc.value || newTc.unit !== oldTc.unit);
			const uncontrolledChanged = newTc.mode === "uncontrolled" && oldTc.mode === "uncontrolled" && (newTc.speed !== oldTc.speed || newTc.duration !== oldTc.duration || newTc.playing !== oldTc.playing || newTc.loop !== oldTc.loop || newTc.delay !== oldTc.delay || newTc.loopGap !== oldTc.loopGap || newTc.catchUp !== oldTc.catchUp || newTc.easing !== oldTc.easing);
			if (modeChanged || controlledValueChanged || uncontrolledChanged) {
				this._timeControl = newTc;
				if (newTc.mode === "uncontrolled") {
					this._playing = newTc.playing ?? true;
					const oldDelay = oldTc.mode === "uncontrolled" ? oldTc.delay ?? 0 : 0;
					const newDelay = newTc.delay ?? 0;
					if (modeChanged || oldDelay !== newDelay) {
						this._delayRemaining = newDelay;
						this._loopGapRemaining = 0;
					}
				}
				dirtyPlayback = true;
				dirtyRender = true;
				this._updateSentinelTransition();
			}
		}
		if ("effects" in options && options.effects !== this._effects) {
			this._effects = options.effects;
			this._resolvedEffects = resolveEffects(this._effects);
			dirtyRender = true;
		}
		if ("timing" in options && options.timing !== this._timing) {
			this._timing = options.timing;
			dirtyTimeline = true;
		}
		if ("quality" in options && options.quality !== this._quality) {
			this._quality = options.quality;
			dirtyRender = true;
		}
		if ("direction" in options && options.direction !== this._direction) {
			this._direction = options.direction;
			dirtyLayout = true;
			dirtyRender = true;
		}
		if ("showOverlay" in options && options.showOverlay !== this._showOverlay) {
			this._showOverlay = options.showOverlay ?? false;
			this._updateOverlayStyle();
			dirtyRender = true;
		}
		if ("onComplete" in options) this._onComplete = options.onComplete;
		if ("onChangeTimeline" in options) this._onChangeTimeline = options.onChangeTimeline;
		if (dirtyTimeline) this._recomputeTimeline();
		if (dirtyRender || dirtyTimeline || dirtyLayout) this._updateDom();
		if (dirtyLayout) this._recomputeLayout();
		if (dirtyPlayback) this._evaluatePlayback();
		if (dirtyRender || dirtyTimeline || dirtyLayout) this._render();
	}
	destroy() {
		this._destroyed = true;
		this._stopLoop();
		this._resizeObserver.disconnect();
		this._sentinelEl.removeEventListener("transitionend", this._onSentinelTransition);
		if (this._mql) if (this._mql.removeEventListener) this._mql.removeEventListener("change", this._onReducedMotionChange);
		else this._mql.removeListener(this._onReducedMotionChange);
		this._contentEl?.remove();
		this._strokeCache = /* @__PURE__ */ new WeakMap();
		this._strokeCacheKey = "";
		this._maskCanvas = null;
	}
	/** Estimate line-height from font metrics when CSS returns "normal". */
	_fallbackLineHeight(fontSize) {
		if (this._font) return (this._font.ascender - this._font.descender) / this._font.unitsPerEm * fontSize;
		return fontSize * 1.2;
	}
	_measure() {
		const styles = getComputedStyle(this._rootEl);
		this._containerWidth = this._rootEl.getBoundingClientRect().width;
		this._fontSize = Number.parseFloat(styles.fontSize);
		const parsedLh = Number.parseFloat(styles.lineHeight);
		this._lineHeight = Number.isNaN(parsedLh) ? this._fallbackLineHeight(this._fontSize) : parsedLh;
		this._currentColor = styles.color;
	}
	_updateDom() {
		this._rootEl.style.fontFamily = this._font ? cssFontFamily(this._font) : "";
		this._rootEl.style.direction = this._direction ?? "";
		this._updateCssProperties();
		if (this._overlayEl.textContent !== this._text) this._overlayEl.textContent = this._text;
		this._canvasFallbackEl.textContent = this._text;
	}
	_updateCssProperties() {
		const time = this.currentTime;
		const dur = this._timeline.totalDuration;
		this._rootEl.style.setProperty(CSS_DURATION, String(dur));
		this._rootEl.style.setProperty(CSS_TIME, String(time));
		this._rootEl.style.setProperty(CSS_PROGRESS, String(dur > 0 ? time / dur : 0));
	}
	_updateOverlayStyle() {
		if (this._showOverlay) {
			this._overlayEl.style.webkitTextFillColor = "";
			this._overlayEl.style.color = "rgba(255, 0, 0, 0.4)";
		} else {
			this._overlayEl.style.webkitTextFillColor = "transparent";
			this._overlayEl.style.color = "";
		}
		this._overlayEl.style.fontFeatureSettings = this._shaperEnabled ? "" : "'liga' 0, 'calt' 0, 'clig' 0, 'rlig' 0, 'dlig' 0, 'init' 0, 'medi' 0, 'fina' 0, 'isol' 0";
	}
	_updateSentinelTransition() {
		const isCss = this._timeControl.mode === "css";
		this._sentinelEl.style.transition = isCss ? `font-size 0.001s, line-height 0.001s, color 0.001s, ${CSS_PROGRESS} 0.001s` : "font-size 0.001s, line-height 0.001s, color 0.001s";
	}
	_onResize = (entries) => {
		const entry = entries[0];
		if (!entry) return;
		const newWidth = entry.contentRect.width;
		const styles = getComputedStyle(this._rootEl);
		const newFontSize = Number.parseFloat(styles.fontSize);
		const parsedLh = Number.parseFloat(styles.lineHeight);
		const newLineHeight = Number.isNaN(parsedLh) ? this._fallbackLineHeight(newFontSize) : parsedLh;
		const newColor = styles.color;
		let changed = false;
		let layoutChanged = false;
		if (newWidth !== this._containerWidth) {
			this._containerWidth = newWidth;
			layoutChanged = true;
			changed = true;
		}
		if (newFontSize !== this._fontSize) {
			this._fontSize = newFontSize;
			layoutChanged = true;
			changed = true;
		}
		if (newLineHeight !== this._lineHeight) {
			this._lineHeight = newLineHeight;
			layoutChanged = true;
			changed = true;
		}
		if (newColor !== this._currentColor) {
			this._currentColor = newColor;
			changed = true;
		}
		if (layoutChanged) this._recomputeLayout();
		if (changed) this._render();
	};
	_onSentinelTransition = (e) => {
		const styles = getComputedStyle(this._sentinelEl);
		let changed = false;
		if (e.propertyName === "font-size" || e.propertyName === "line-height") {
			const newFontSize = Number.parseFloat(styles.fontSize);
			const parsedLh = Number.parseFloat(styles.lineHeight);
			const newLineHeight = Number.isNaN(parsedLh) ? this._fallbackLineHeight(newFontSize) : parsedLh;
			if (newFontSize !== this._fontSize || newLineHeight !== this._lineHeight) {
				this._fontSize = newFontSize;
				this._lineHeight = newLineHeight;
				this._recomputeLayout();
				changed = true;
			}
		}
		if (e.propertyName === "color") {
			const newColor = styles.color;
			if (newColor !== this._currentColor) {
				this._currentColor = newColor;
				changed = true;
			}
		}
		if (e.propertyName === "--tegaki-progress") {
			const rawProgress = Number(styles.getPropertyValue(CSS_PROGRESS));
			this._cssTime = rawProgress * this._timeline.totalDuration;
			changed = true;
		}
		if (changed) this._render();
	};
	_onReducedMotionChange = (e) => {
		this._prefersReducedMotion = e.matches;
		if (this._prefersReducedMotion && this._timeControl.mode === "uncontrolled" && this._timeline.totalDuration > 0) this._internalTime = this._timeline.totalDuration;
		this._evaluatePlayback();
		this._render();
	};
	_loadFont(font) {
		this._font = font;
		this._fontReady = false;
		if (!font) {
			this._loadShaper();
			return;
		}
		const pending = ensureFont(font.family, font.fontUrl, font.features, font.extraFontUrls);
		if (pending === null) this._fontReady = true;
		else {
			const currentFont = font;
			pending.then(() => {
				if (this._font === currentFont && !this._destroyed) {
					this._fontReady = true;
					this._recomputeTimeline();
					this._updateDom();
					this._recomputeLayout();
					this._evaluatePlayback();
					this._render();
				}
			});
		}
		this._loadShaper();
	}
	/**
	* Resolve the shaper for the current font. Called when the font changes or
	* when the `shaper` option is toggled. Drops any in-flight shaper for the
	* previous font; the `_font === currentFont` guard inside the promise
	* handler discards stale resolutions.
	*/
	_loadShaper() {
		this._shaper = null;
		this._shaperReady = true;
		if (!this._shaperEnabled || !this._font) return;
		const shaperPromise = getShaperForBundle(this._font);
		if (!shaperPromise) return;
		this._shaperReady = false;
		const currentFont = this._font;
		shaperPromise.then((shaper) => {
			if (this._font === currentFont && this._shaperEnabled && !this._destroyed) {
				this._shaper = shaper;
				this._shaperReady = true;
				this._recomputeTimeline();
				this._recomputeLayout();
				this._evaluatePlayback();
				this._render();
			}
		});
	}
	_recomputeTimeline() {
		if (this._font && this._text) this._timeline = computeTimeline(this._text, this._font, this._timing, this._shaper);
		else this._timeline = {
			entries: [],
			totalDuration: 0
		};
		this._onChangeTimeline?.(this._timeline);
	}
	_recomputeLayout() {
		if (this._fontReady && this._font?.family && this._fontSize && this._containerWidth && this._text) {
			const shaperId = this._shaper ? "1" : "0";
			const key = `${this._text}\0${this._font.family}\0${this._fontSize}\0${this._lineHeight}\0${this._containerWidth}\0${this._direction ?? ""}\0${shaperId}`;
			if (key === this._layoutKey) return;
			this._layoutKey = key;
			let layout = computeTextLayout(this._overlayEl, this._fontSize);
			if (this._shaper && this._font) layout = applyShaperPositions(layout, this._overlayEl, this._text, this._fontSize, this._font, this._shaper, this._timeline);
			this._layout = layout;
		} else {
			this._layoutKey = "";
			this._layout = null;
		}
	}
	_evaluatePlayback() {
		if (this._timeControl.mode === "uncontrolled" && this._playing && !!this._font && this._fontReady && this._shaperReady && !this._prefersReducedMotion) this._startLoop();
		else this._stopLoop();
	}
	_startLoop() {
		if (this._rafId) return;
		this._lastTs = null;
		this._smoothedBoost = 0;
		this._rafId = requestAnimationFrame(this._tick);
	}
	_stopLoop() {
		if (this._rafId) {
			cancelAnimationFrame(this._rafId);
			this._rafId = 0;
		}
	}
	_tick = (ts) => {
		if (this._destroyed) return;
		if (this._lastTs === null) this._lastTs = ts;
		const dtSec = (ts - this._lastTs) / 1e3;
		this._lastTs = ts;
		const tc = this._timeControl;
		if (tc.mode !== "uncontrolled") return;
		const loop = tc.loop ?? false;
		const totalDur = this._timeline.totalDuration;
		const durationOverride = tc.duration;
		const useDuration = durationOverride !== void 0 && durationOverride > 0;
		if (totalDur === 0 || !loop && this._internalTime >= totalDur) {
			this._internalTime = totalDur;
			this._rafId = requestAnimationFrame(this._tick);
			return;
		}
		if (this._delayRemaining > 0) {
			this._delayRemaining = Math.max(0, this._delayRemaining - dtSec);
			this._rafId = requestAnimationFrame(this._tick);
			return;
		}
		if (this._loopGapRemaining > 0) {
			this._loopGapRemaining = Math.max(0, this._loopGapRemaining - dtSec);
			if (this._loopGapRemaining <= 0) {
				this._internalTime = 0;
				this._prevCompleted = false;
				this._smoothedBoost = 0;
			}
			this._notifyTimeChange();
			this._render();
			this._updateCssProperties();
			this._rafId = requestAnimationFrame(this._tick);
			return;
		}
		let effectiveSpeed;
		if (useDuration) effectiveSpeed = totalDur / durationOverride;
		else {
			const speed = tc.speed ?? 1;
			const catchUp = tc.catchUp ?? 0;
			effectiveSpeed = speed;
			if (catchUp > 0) {
				const remaining = Math.max(0, totalDur - this._internalTime);
				const targetBoost = catchUp * Math.max(0, remaining - 2);
				const attackRate = 4;
				const releaseRate = loop ? 30 : 2;
				const rate = targetBoost > this._smoothedBoost ? attackRate : releaseRate;
				this._smoothedBoost += (targetBoost - this._smoothedBoost) * (1 - Math.exp(-rate * dtSec));
				effectiveSpeed = speed + this._smoothedBoost;
			}
		}
		let next = this._internalTime + dtSec * effectiveSpeed;
		if (next >= totalDur) {
			if (loop) {
				const loopGap = tc.loopGap ?? 0;
				if (loopGap > 0) {
					next = totalDur;
					this._loopGapRemaining = loopGap;
				} else if (this._internalTime < totalDur) next = totalDur;
				else next %= totalDur;
			} else next = totalDur;
			this._smoothedBoost = 0;
		}
		this._internalTime = next;
		this._notifyTimeChange();
		this._checkCompletion();
		this._render();
		this._updateCssProperties();
		this._rafId = requestAnimationFrame(this._tick);
	};
	_notifyTimeChange() {
		const tc = this._timeControl;
		if (tc.mode === "uncontrolled" && tc.onTimeChange) tc.onTimeChange(this.currentTime);
	}
	_checkCompletion() {
		const complete = this.isComplete;
		if (complete && !this._prevCompleted) {
			this._prevCompleted = true;
			this._onComplete?.();
		} else if (!complete) this._prevCompleted = false;
	}
	_render() {
		const canvas = this._canvasEl;
		const font = this._font;
		const layout = this._layout;
		const fontSize = this._fontSize;
		const effectiveDpr = (window.devicePixelRatio || 1) * Math.max(this._quality?.pixelRatio ?? 1, 0);
		const w = canvas.offsetWidth;
		const h = canvas.offsetHeight;
		if (canvas.width !== Math.round(w * effectiveDpr) || canvas.height !== Math.round(h * effectiveDpr)) {
			canvas.width = Math.round(w * effectiveDpr);
			canvas.height = Math.round(h * effectiveDpr);
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);
		ctx.clearRect(0, 0, w, h);
		if (!font?.glyphData || !layout || !fontSize) return;
		const padH = PADDING_H_EM * fontSize;
		const lineHeight = this._lineHeight;
		const padV = Math.max(MIN_PADDING_V_EM * fontSize, (MIN_LINE_HEIGHT_EM * fontSize - lineHeight) / 2);
		ctx.translate(padH, padV);
		const color = this._currentColor || "black";
		const halfLeading = (lineHeight - (font.ascender - font.descender) / font.unitsPerEm * fontSize) / 2;
		const characters = graphemes(this._text);
		const currentTime = this.currentTime;
		const effectsNeedSubdivision = !!findEffect(this._resolvedEffects, "wobble") || !!findEffect(this._resolvedEffects, "strokeGradient") || !!findEffect(this._resolvedEffects, "taper") || (() => {
			const p = findEffect(this._resolvedEffects, "pressureWidth");
			return !!p && Math.max(0, Math.min(p.config.strength ?? 1, 1)) > 0;
		})();
		const smoothing = this._quality?.smoothing === true;
		const resolvedSegmentSize = this._quality?.segmentSize ?? (effectsNeedSubdivision || smoothing ? 2 : void 0);
		const scale = fontSize / font.unitsPerEm;
		const maxSegLenFU = resolvedSegmentSize != null ? resolvedSegmentSize / scale : Infinity;
		const cacheKey = `${font.family}|${maxSegLenFU}|${smoothing ? "s" : "l"}`;
		if (cacheKey !== this._strokeCacheKey) {
			this._strokeCache = /* @__PURE__ */ new WeakMap();
			this._strokeCacheKey = cacheKey;
		}
		const strokeCache = this._strokeCache;
		const getSubdivided = (stroke) => {
			let sub = strokeCache.get(stroke);
			if (!sub) {
				sub = subdivideStroke(stroke, maxSegLenFU, smoothing);
				strokeCache.set(stroke, sub);
			}
			return sub;
		};
		const clipText = this._quality?.clipText;
		const strokeScale = typeof clipText === "number" ? clipText : 1;
		const stage = hasRenderHooks(this._resolvedEffects) ? {
			ctx,
			layout,
			fontSize,
			lineHeight,
			unitsPerEm: font.unitsPerEm,
			ascender: font.ascender,
			descender: font.descender,
			bbox: computeLayoutBbox(layout, fontSize, lineHeight),
			baseColor: color,
			seed: this._seed
		} : null;
		if (stage) for (const effect of this._resolvedEffects) getEffectDefinition(effect.effect)?.beforeRender?.(stage, effect.config);
		const graphemeToLine = new Int32Array(characters.length).fill(-1);
		for (let li = 0; li < layout.lines.length; li++) {
			const lineIndices = layout.lines[li];
			for (const charIdx of lineIndices) graphemeToLine[charIdx] = li;
		}
		for (let ei = 0; ei < this._timeline.entries.length; ei++) {
			const entry = this._timeline.entries[ei];
			if (entry.char === "\n") continue;
			const charIdx = entry.graphemeIndex;
			const lineIdx = graphemeToLine[charIdx] ?? -1;
			if (lineIdx < 0) continue;
			const y = lineIdx * lineHeight;
			const lineLeftEm = layout.lineLefts?.[lineIdx];
			const x = entry.xOffsetEm !== void 0 && lineLeftEm !== void 0 ? (lineLeftEm + entry.xOffsetEm) * fontSize : (layout.charOffsets[charIdx] ?? 0) * fontSize;
			const glyph = (entry.glyphId !== void 0 ? font.glyphDataById?.[entry.glyphId] : void 0) ?? lookupGlyphData(font, entry.char);
			if (glyph && entry.hasGlyph) {
				let localTime = Math.max(0, Math.min(currentTime - entry.offset, entry.duration));
				const glyphEasing = this._timing?.glyphEasing;
				if (glyphEasing && entry.duration > 0) localTime = glyphEasing(localTime / entry.duration) * entry.duration;
				drawGlyph(ctx, glyph, {
					x,
					y: y + halfLeading + (entry.yOffsetEm ?? 0) * fontSize,
					fontSize,
					unitsPerEm: font.unitsPerEm,
					ascender: font.ascender,
					descender: font.descender
				}, localTime, font.lineCap, color, this._resolvedEffects, this._seed + charIdx, getSubdivided, this._timing?.strokeEasing, strokeScale, stage?.strokeStyle, entry.strokeDelays, entry.strokeTimeScale);
			} else if (!entry.hasGlyph && currentTime >= entry.offset + entry.duration) {
				const baseline = y + halfLeading + font.ascender / font.unitsPerEm * fontSize;
				drawFallbackGlyph(ctx, entry.char, x, baseline, fontSize, cssFontFamily(font), color, this._resolvedEffects, this._seed + charIdx);
			}
		}
		if (stage) for (let i = this._resolvedEffects.length - 1; i >= 0; i--) {
			const effect = this._resolvedEffects[i];
			getEffectDefinition(effect.effect)?.afterRender?.(stage, effect.config);
		}
		if (clipText) {
			if (!this._maskCanvas) this._maskCanvas = document.createElement("canvas");
			const maskCanvas = this._maskCanvas;
			if (maskCanvas.width !== canvas.width || maskCanvas.height !== canvas.height) {
				maskCanvas.width = canvas.width;
				maskCanvas.height = canvas.height;
			}
			const maskCtx = maskCanvas.getContext("2d");
			maskCtx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);
			maskCtx.clearRect(0, 0, w, h);
			maskCtx.translate(padH, padV);
			maskCtx.font = `${fontSize}px ${cssFontFamily(font)}`;
			maskCtx.textBaseline = "alphabetic";
			let clipY = 0;
			for (const lineIndices of layout.lines) {
				let lineText = "";
				for (const charIdx of lineIndices) {
					const char = characters[charIdx];
					if (char === "\n") continue;
					lineText += char;
				}
				if (lineText) {
					const baseline = clipY + halfLeading + font.ascender / font.unitsPerEm * fontSize;
					maskCtx.fillText(lineText, 0, baseline);
				}
				clipY += lineHeight;
			}
			ctx.save();
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.globalCompositeOperation = "destination-in";
			ctx.drawImage(maskCanvas, 0, 0);
			ctx.restore();
		}
	}
};
//#endregion
export { getEffectDefinition as _, createBundle as a, resolveBundle as c, computeLayoutBbox as d, computeTextLayout as f, findEffects as g, findEffect as h, domCreateElement as i, BUNDLE_VERSION as l, drawGlyph as m, buildChildren as n, getBundle as o, ensureFontFace as p, buildRootProps as r, registerBundle as s, TegakiEngine as t, COMPATIBLE_BUNDLE_VERSIONS as u, hasRenderHooks as v, resolveEffects as y };

//# sourceMappingURL=core-VIBhSqFM.mjs.map