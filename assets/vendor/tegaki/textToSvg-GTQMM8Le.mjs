//#region src/lib/catmullRom.ts
/**
* Sample `count` points along a centripetal Catmull-Rom segment from `p1` to
* `p2`, with neighbor control points `p0` and `p3`. Samples are emitted at
* `u = k/count` for `k = 1..count`, so the last sample equals `p2`.
*
* Centripetal parameterization (α = 0.5) avoids the cusps and self-loops that
* uniform/chordal Catmull-Rom can produce on sharp corners — relevant for the
* baked RDP-simplified polylines the renderer consumes.
*
* For endpoint segments where a neighbor is missing, pass a phantom point
* built with {@link reflect}. Zero-length chords are clamped to a tiny epsilon
* so the knot parameterization stays non-degenerate.
*/
function sampleCatmullRom(p0, p1, p2, p3, count) {
	const d01 = Math.max(dist(p0, p1), 1e-6);
	const d12 = Math.max(dist(p1, p2), 1e-6);
	const d23 = Math.max(dist(p2, p3), 1e-6);
	const t0 = 0;
	const t1 = t0 + Math.sqrt(d01);
	const t2 = t1 + Math.sqrt(d12);
	const t3 = t2 + Math.sqrt(d23);
	const out = new Array(count);
	for (let k = 1; k <= count; k++) {
		const t = t1 + k / count * (t2 - t1);
		out[k - 1] = evalBarryGoldman(p0, p1, p2, p3, t0, t1, t2, t3, t);
	}
	return out;
}
/**
* Reflect `p` across `anchor` to produce a phantom neighbor for endpoint
* segments. The result lies on the extension of (p, anchor) past `anchor` at
* the same distance — equivalent to a zero-curvature extrapolation, which
* gives a natural straight start/end tangent.
*/
function reflect(anchor, p) {
	return [
		2 * anchor[0] - p[0],
		2 * anchor[1] - p[1],
		anchor[2]
	];
}
function dist(a, b) {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	return Math.sqrt(dx * dx + dy * dy);
}
function evalBarryGoldman(p0, p1, p2, p3, t0, t1, t2, t3, t) {
	const a1x = lerp(p0[0], p1[0], t0, t1, t);
	const a1y = lerp(p0[1], p1[1], t0, t1, t);
	const a1w = lerp(p0[2], p1[2], t0, t1, t);
	const a2x = lerp(p1[0], p2[0], t1, t2, t);
	const a2y = lerp(p1[1], p2[1], t1, t2, t);
	const a2w = lerp(p1[2], p2[2], t1, t2, t);
	const a3x = lerp(p2[0], p3[0], t2, t3, t);
	const a3y = lerp(p2[1], p3[1], t2, t3, t);
	const a3w = lerp(p2[2], p3[2], t2, t3, t);
	const b1x = lerp(a1x, a2x, t0, t2, t);
	const b1y = lerp(a1y, a2y, t0, t2, t);
	const b1w = lerp(a1w, a2w, t0, t2, t);
	const b2x = lerp(a2x, a3x, t1, t3, t);
	const b2y = lerp(a2y, a3y, t1, t3, t);
	const b2w = lerp(a2w, a3w, t1, t3, t);
	return {
		x: lerp(b1x, b2x, t1, t2, t),
		y: lerp(b1y, b2y, t1, t2, t),
		width: lerp(b1w, b2w, t1, t2, t)
	};
}
function lerp(a, b, ta, tb, t) {
	const span = tb - ta;
	if (span === 0) return a;
	return a + (b - a) * ((t - ta) / span);
}
//#endregion
//#region src/lib/strokeCache.ts
/**
* Subdivide a stroke so that no sub-segment exceeds `maxSegLen` font units.
* Pass `Infinity` (or any non-finite value) to skip subdivision and return
* the raw polyline.
*
* When `smoothing` is true, intermediate vertices are placed on a centripetal
* Catmull-Rom spline through the original points (see `catmullRom.ts`) —
* hiding the polyline facets that show up at large render sizes. The original
* points remain on the curve, so endpoints and `cumLen`/`idx` semantics are
* preserved. Has no effect when `maxSegLen` is non-finite (no subdivision).
*
* Output depends only on `(stroke.p, maxSegLen, smoothing)` — not on position,
* seed, progress, or effect config — so it can be cached and shared across
* every instance of the same glyph at the same font size.
*/
function subdivideStroke(stroke, maxSegLen, smoothing = false) {
	const pts = stroke.p;
	const n = pts.length;
	if (n === 0) return {
		vertices: [],
		totalLen: 0,
		avgWidth: 0
	};
	const first = pts[0];
	const vertices = [{
		x: first[0],
		y: first[1],
		width: first[2],
		cumLen: 0,
		idx: 0
	}];
	let cumLen = 0;
	for (let j = 1; j < n; j++) {
		const prev = pts[j - 1];
		const cur = pts[j];
		const dx = cur[0] - prev[0];
		const dy = cur[1] - prev[1];
		const chordLen = Math.sqrt(dx * dx + dy * dy);
		const count = chordLen > 0 && Number.isFinite(maxSegLen) && maxSegLen > 0 ? Math.max(1, Math.ceil(chordLen / maxSegLen)) : 1;
		if (smoothing && count > 1) {
			const samples = sampleCatmullRom(j >= 2 ? pts[j - 2] : reflect(prev, cur), prev, cur, j + 1 < n ? pts[j + 1] : reflect(cur, prev), count);
			let px = prev[0];
			let py = prev[1];
			let segAccum = 0;
			for (let k = 0; k < count; k++) {
				const s = samples[k];
				const ex = s.x - px;
				const ey = s.y - py;
				segAccum += Math.sqrt(ex * ex + ey * ey);
				vertices.push({
					x: s.x,
					y: s.y,
					width: s.width,
					cumLen: cumLen + segAccum,
					idx: j - 1 + (k + 1) / count
				});
				px = s.x;
				py = s.y;
			}
			cumLen += segAccum;
		} else {
			const dw = cur[2] - prev[2];
			for (let k = 1; k <= count; k++) {
				const t = k / count;
				vertices.push({
					x: prev[0] + dx * t,
					y: prev[1] + dy * t,
					width: prev[2] + dw * t,
					cumLen: cumLen + chordLen * t,
					idx: j - 1 + t
				});
			}
			cumLen += chordLen;
		}
	}
	let widthSum = 0;
	for (const p of pts) widthSum += p[2];
	return {
		vertices,
		totalLen: cumLen,
		avgWidth: widthSum / n
	};
}
//#endregion
//#region src/lib/utils.ts
const segmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter(void 0, { granularity: "grapheme" }) : null;
/** Resolve a CSSLength to pixels. Plain numbers are px, `"Nem"` is N * fontSize. */
function resolveCSSLength(value, fontSize) {
	if (typeof value === "number") return value;
	return parseFloat(value) * fontSize;
}
function graphemes(text) {
	if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
	return Array.from(text);
}
/**
* Build the CSS `font-family` value for a bundle, including the full
* (non-subsetted) family as fallback when the bundle was generated from a subset.
*/
function cssFontFamily(bundle) {
	if (bundle.fullFamily) return `'${bundle.family}', '${bundle.fullFamily}'`;
	return `'${bundle.family}'`;
}
/**
* Look up `glyphData` for a grapheme cluster, with a fallback to its leading
* codepoint. Devanagari clusters like `"हि"` or `"न्दी"` have no entry in the
* single-codepoint-keyed `glyphData`; without the fallback every shaped glyph
* inside such a cluster that the variant map skipped (i.e. nominal forms like
* the bare `ह`) would resolve to `undefined`, get tagged `hasGlyph: false`,
* and collapse onto the 0.2s `unknownDuration` slot — drawn at end-of-slot
* via DOM `fillText`. The fallback resolves the cluster's first codepoint
* (e.g. `ह` from `"हि"`), so the nominal glyph picks up its real stroke data
* and animates instead of popping in.
*/
function lookupGlyphData(font, char) {
	const direct = font.glyphData[char];
	if (direct || char.length <= 1) return direct;
	const cp = char.codePointAt(0);
	if (cp === void 0) return void 0;
	return font.glyphData[String.fromCodePoint(cp)];
}
function coerceToString(value) {
	if (value == null || typeof value === "boolean") return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "bigint") return String(value);
	if (Array.isArray(value)) return value.map(coerceToString).join("");
	return "";
}
//#endregion
//#region src/lib/css-properties.ts
const CSS_TIME = "--tegaki-time";
const CSS_PROGRESS = "--tegaki-progress";
const CSS_DURATION = "--tegaki-duration";
const PADDING_H_EM = .2;
const MIN_LINE_HEIGHT_EM = 1.8;
const MIN_PADDING_V_EM = .2;
let cssPropertiesRegistered = false;
function registerCssProperties() {
	if (cssPropertiesRegistered) return;
	cssPropertiesRegistered = true;
	if (typeof CSS !== "undefined" && "registerProperty" in CSS) for (const prop of [
		CSS_TIME,
		CSS_PROGRESS,
		CSS_DURATION
	]) try {
		CSS.registerProperty({
			name: prop,
			syntax: "<number>",
			inherits: true,
			initialValue: "0"
		});
	} catch {}
}
//#endregion
//#region src/lib/svgExport.ts
const LOOP_HOLD = 1.5;
const LOOP_FADE = .3;
const LOOP_GAP = .7;
/**
* Looping CSS-keyframe variant. Each stroke draws via `stroke-dashoffset` on a
* constant-width path, holds while the rest of the word finishes, fades out
* together, then resets — animating forever. No masks or SMIL, so it animates
* in GitHub's `<img>`-embedded SVGs.
*/
function buildLoopingSvg(items, cfg) {
	const total = Math.max(cfg.totalDuration, .001);
	const cycle = total + LOOP_HOLD + LOOP_FADE + LOOP_GAP;
	const holdEndPct = (total + LOOP_HOLD) / cycle * 100;
	const fadeEndPct = (total + LOOP_HOLD + LOOP_FADE) / cycle * 100;
	const keyframes = [];
	const rules = [];
	const els = [];
	let si = 0;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const grow = (x, y, r) => {
		if (x - r < minX) minX = x - r;
		if (y - r < minY) minY = y - r;
		if (x + r > maxX) maxX = x + r;
		if (y + r > maxY) maxY = y + r;
	};
	for (const item of items) {
		const { glyph, ox, oy, scale, ascender, offset } = item;
		const px = (fx) => ox + fx * scale;
		const py = (fy) => oy + (fy + ascender) * scale;
		for (const stroke of glyph.s) {
			const rawPts = stroke.p;
			if (rawPts.length === 0) continue;
			const beginPct = (offset + stroke.d) / cycle * 100;
			const drawEndPct = (offset + stroke.d + stroke.a) / cycle * 100;
			const lead = beginPct <= .005 ? "0%" : `0%,${fmt(beginPct)}%`;
			const isDegenerate = rawPts.length > 1 && rawPts.every((p) => p[0] === rawPts[0][0] && p[1] === rawPts[0][1]);
			if (rawPts.length === 1 || isDegenerate) {
				const p = rawPts[0];
				const w = Math.max(p[2], .5) * scale * cfg.strokeScale;
				grow(px(p[0]), py(p[1]), w / 2);
				if (beginPct <= .005) els.push(`<circle cx="${fmt(px(p[0]))}" cy="${fmt(py(p[1]))}" r="${fmt(w / 2)}" fill="${cfg.color}" />`);
				else {
					const onPct = Math.min(beginPct + .4, holdEndPct);
					keyframes.push(`@keyframes tk-d${si} { ${lead} { opacity:0 } ${fmt(onPct)}%,100% { opacity:1 } }`);
					rules.push(`.tk-s${si} { animation: tk-d${si} ${fmt(cycle)}s infinite }`);
					els.push(`<circle class="tk-s${si}" cx="${fmt(px(p[0]))}" cy="${fmt(py(p[1]))}" r="${fmt(w / 2)}" fill="${cfg.color}" opacity="0" />`);
				}
				si++;
				continue;
			}
			const { vertices, totalLen, avgWidth } = subdivideStroke(stroke, cfg.segmentLengthFU, cfg.smoothing);
			if (vertices.length < 2 || totalLen <= 0) continue;
			const d = `M ${fmt(px(vertices[0].x))} ${fmt(py(vertices[0].y))} ` + vertices.slice(1).map((v) => `L ${fmt(px(v.x))} ${fmt(py(v.y))}`).join(" ");
			let plen = 0;
			for (let i = 1; i < vertices.length; i++) {
				const a = vertices[i - 1];
				const b = vertices[i];
				plen += Math.hypot((b.x - a.x) * scale, (b.y - a.y) * scale);
			}
			const wpx = Math.max(avgWidth, .5) * scale * cfg.strokeScale;
			for (const v of vertices) grow(px(v.x), py(v.y), wpx / 2);
			const L = plen + wpx;
			keyframes.push(`@keyframes tk-d${si} { ${lead} { stroke-dashoffset:${fmt(L)} } ${fmt(drawEndPct)}%,${fmt(holdEndPct)}% { stroke-dashoffset:0 } ${fmt(fadeEndPct)}%,100% { stroke-dashoffset:${fmt(L)} } }`);
			rules.push(`.tk-s${si} { animation: tk-d${si} ${fmt(cycle)}s infinite }`);
			els.push(`<path class="tk-s${si}" d="${d}" fill="none" stroke="${cfg.color}" stroke-width="${fmt(wpx)}" stroke-linecap="${cfg.lineCap}" stroke-linejoin="round" stroke-dasharray="${fmt(L)}" stroke-dashoffset="${fmt(L)}" />`);
			si++;
		}
	}
	keyframes.push(`@keyframes tk-fade { 0%,${fmt(holdEndPct)}% { opacity:1 } ${fmt(fadeEndPct)}%,100% { opacity:0 } }`);
	rules.push(`.tk-grp { animation: tk-fade ${fmt(cycle)}s infinite }`);
	const pad = 8;
	const hasInk = Number.isFinite(minX);
	const vbX = hasInk ? minX - pad : 0;
	const vbY = hasInk ? minY - pad : 0;
	const vbW = hasInk ? maxX - minX + pad * 2 : cfg.width;
	const vbH = hasInk ? maxY - minY + pad * 2 : cfg.height;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(vbX)} ${fmt(vbY)} ${fmt(vbW)} ${fmt(vbH)}" width="${fmt(vbW)}" height="${fmt(vbH)}">\n<style>${keyframes.join(" ")} ${rules.join(" ")}</style>\n<g class="tk-grp">\n${els.join("\n")}\n</g>\n</svg>`;
}
function fmt(n) {
	return (Math.round(n * 100) / 100).toString();
}
const EASE_OUT_SPLINE = "0.33 0 0.15 1";
/**
* Serialize positioned glyphs to a standalone SVG string. Variable width is
* achieved exactly as the canvas renderer does it (drawGlyph's per-segment
* path): one `<line>` per sub-segment, each with its own `stroke-width`, round
* caps overlapping to read continuous.
*
* Animated mode reveals each stroke through a `<mask>` whose centerline is
* stroked thick and dash-animated, so the variable-width fill is uncovered in
* pen order over the stroke's own [delay, delay+duration] window.
*
* Not yet modelled in SVG: glow, wobble, gradient, taper, and clip-to-text.
* pressureWidth (variable width) is fully honoured.
*/
function placementsToSvg(items, cfg) {
	if (cfg.loop) return buildLoopingSvg(items, cfg);
	const pressure = Math.max(0, Math.min(cfg.pressure, 1));
	const body = [];
	const defs = [];
	let maskId = 0;
	for (const item of items) {
		const { glyph, ox, oy, scale, ascender, offset } = item;
		const px = (fx) => ox + fx * scale;
		const py = (fy) => oy + (fy + ascender) * scale;
		for (const stroke of glyph.s) {
			const rawPts = stroke.p;
			if (rawPts.length === 0) continue;
			const beginAt = offset + stroke.d;
			const dur = stroke.a;
			const isDegenerate = rawPts.length > 1 && rawPts.every((p) => p[0] === rawPts[0][0] && p[1] === rawPts[0][1]);
			if (rawPts.length === 1 || isDegenerate) {
				const p = rawPts[0];
				const w = Math.max(p[2], .5) * scale * cfg.strokeScale;
				const reveal = cfg.animated ? `><animate attributeName="opacity" values="0;1" dur="0.01s" begin="${fmt(beginAt)}s" fill="freeze" /></circle>` : ` />`;
				body.push(`<circle cx="${fmt(px(p[0]))}" cy="${fmt(py(p[1]))}" r="${fmt(w / 2)}" fill="${cfg.color}"${cfg.animated ? " opacity=\"0\"" : ""}${reveal}`);
				continue;
			}
			const { vertices, totalLen, avgWidth } = subdivideStroke(stroke, cfg.segmentLengthFU, cfg.smoothing);
			if (vertices.length < 2 || totalLen <= 0) continue;
			const baseWidth = Math.max(avgWidth, .5) * scale * cfg.strokeScale;
			const segs = [];
			let maxW = 0;
			for (let i = 1; i < vertices.length; i++) {
				const a = vertices[i - 1];
				const b = vertices[i];
				const perPoint = (a.width + b.width) * .5 * scale * cfg.strokeScale;
				const w = Math.max(baseWidth + (perPoint - baseWidth) * pressure, .5 * scale * cfg.strokeScale);
				if (w > maxW) maxW = w;
				segs.push(`<line x1="${fmt(px(a.x))}" y1="${fmt(py(a.y))}" x2="${fmt(px(b.x))}" y2="${fmt(py(b.y))}" stroke-width="${fmt(w)}" />`);
			}
			if (!cfg.animated) {
				body.push(`<g fill="none" stroke="${cfg.color}" stroke-linecap="${cfg.lineCap}" stroke-linejoin="round">\n${segs.join("\n")}\n</g>`);
				continue;
			}
			const id = `tk-m${maskId++}`;
			const d = `M ${fmt(px(vertices[0].x))} ${fmt(py(vertices[0].y))} ` + vertices.slice(1).map((v) => `L ${fmt(px(v.x))} ${fmt(py(v.y))}`).join(" ");
			const coverW = maxW + 4;
			const animate = dur > 0 ? `<animate attributeName="stroke-dashoffset" values="1;0" keyTimes="0;1" calcMode="spline" keySplines="${EASE_OUT_SPLINE}" dur="${fmt(dur)}s" begin="${fmt(beginAt)}s" fill="freeze" />` : `<set attributeName="stroke-dashoffset" to="0" begin="${fmt(beginAt)}s" />`;
			defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse"><path d="${d}" fill="none" stroke="#fff" stroke-width="${fmt(coverW)}" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1">${animate}</path></mask>`);
			body.push(`<g mask="url(#${id})" fill="none" stroke="${cfg.color}" stroke-linecap="${cfg.lineCap}" stroke-linejoin="round">\n${segs.join("\n")}\n</g>`);
		}
	}
	const defsBlock = defs.length > 0 ? `<defs>\n${defs.join("\n")}\n</defs>\n` : "";
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(cfg.width)} ${fmt(cfg.height)}" width="${fmt(cfg.width)}" height="${fmt(cfg.height)}">\n${defsBlock}${body.join("\n")}\n</svg>`;
}
//#endregion
//#region src/lib/timeline.ts
const DEFAULTS = {
	glyphGap: .1,
	wordGap: .15,
	lineGap: .3,
	unknownDuration: .2,
	deferDots: true
};
function computeTimeline(text, font, config, shaper) {
	if (shaper && font.glyphDataById) return computeShapedTimeline(text, font, config, shaper);
	return computeGraphemeTimeline(text, font, config);
}
/** Parse a stagger advance value into seconds, given the previous glyph's bundled duration. */
function resolveAdvance(advance, prevBundled) {
	if (typeof advance === "number") return Math.max(0, advance);
	const m = /^(-?\d+(?:\.\d+)?)\s*%$/.exec(advance);
	if (m) {
		const pct = Number(m[1]) / 100;
		return Math.max(0, pct * prevBundled);
	}
	const n = Number(advance);
	return Number.isFinite(n) ? Math.max(0, n) : 0;
}
var StaggerScheduler = class {
	wordGap;
	lineGap;
	advance;
	staticDuration;
	entries = [];
	offset = 0;
	/**
	* Effective duration of the most recent glyph (= `staticDuration` when set,
	* else its bundled `glyph.t`). Basis for percent advances — so
	* `advance: '100%'` always means "start once the previous glyph finishes",
	* independent of whether the duration was overridden.
	*/
	prevEffective = 0;
	hasPrev = false;
	/** Accumulated word/line gap pending until the next glyph (or finalize). */
	pendingGap = 0;
	constructor(wordGap, lineGap, advance, staticDuration) {
		this.wordGap = wordGap;
		this.lineGap = lineGap;
		this.advance = advance;
		this.staticDuration = staticDuration;
	}
	addGlyph(fields, bundledDuration) {
		if (this.hasPrev) {
			this.offset += resolveAdvance(this.advance, this.prevEffective) + this.pendingGap;
			this.pendingGap = 0;
		}
		const duration = this.staticDuration ?? bundledDuration;
		const strokeTimeScale = bundledDuration > 0 ? duration / bundledDuration : 1;
		this.entries.push({
			...fields,
			offset: this.offset,
			duration,
			...strokeTimeScale !== 1 ? { strokeTimeScale } : {}
		});
		this.prevEffective = duration;
		this.hasPrev = true;
	}
	/** Emit a zero-duration marker (e.g. whitespace) at the current offset without advancing the cursor. */
	addMarker(fields) {
		this.entries.push({
			...fields,
			offset: this.offset,
			duration: 0
		});
	}
	separator(sep) {
		this.pendingGap += sep === "line" ? this.lineGap : this.wordGap;
	}
	finalize() {
		let total = 0;
		for (const e of this.entries) {
			const end = e.offset + e.duration;
			if (end > total) total = end;
		}
		return {
			entries: this.entries,
			totalDuration: total
		};
	}
};
/** Decompose a glyph into a body phase and an optional dot phase. */
function partitionGlyph(glyph, fallbackTotal, deferDots) {
	const strokes = glyph.s;
	let bodyDuration = 0;
	let dotMinD = Infinity;
	let dotMaxEnd = 0;
	const dotIndices = [];
	const dotDelays = [];
	for (let i = 0; i < strokes.length; i++) {
		const s = strokes[i];
		const end = s.d + s.a;
		if (deferDots && (s.r ?? 0) < 0) {
			dotIndices.push(i);
			dotDelays.push(s.d);
			if (s.d < dotMinD) dotMinD = s.d;
			if (end > dotMaxEnd) dotMaxEnd = end;
		} else if (end > bodyDuration) bodyDuration = end;
	}
	if (dotIndices.length === 0) return {
		bodyDuration: glyph.t ?? fallbackTotal,
		dotDuration: 0,
		dotMinD: 0,
		dotIndices,
		dotDelays
	};
	if (bodyDuration === 0) return {
		bodyDuration: glyph.t ?? fallbackTotal,
		dotDuration: 0,
		dotMinD: 0,
		dotIndices: [],
		dotDelays: []
	};
	return {
		bodyDuration,
		dotDuration: dotMaxEnd - dotMinD,
		dotMinD,
		dotIndices,
		dotDelays
	};
}
var Scheduler = class {
	glyphGap;
	wordGap;
	lineGap;
	entries = [];
	group = [];
	offset = 0;
	/** Gap appended by the last `separate` call; stripped on `finalize` when no further content followed. */
	lastGap = 0;
	constructor(glyphGap, wordGap, lineGap) {
		this.glyphGap = glyphGap;
		this.wordGap = wordGap;
		this.lineGap = lineGap;
	}
	add(p) {
		this.lastGap = 0;
		this.group.push(p);
	}
	/**
	* Close the current word group and advance by a separator gap. Optionally
	* emits a zero-width marker entry (e.g. a whitespace grapheme / cluster)
	* between the group end and the gap.
	*/
	separate(sep, marker) {
		this.flushGroup();
		if (marker) {
			this.entries.push({
				...marker.fields,
				offset: this.offset,
				duration: marker.duration
			});
			this.offset += marker.duration;
		}
		const gap = sep === "line" ? this.lineGap : this.wordGap;
		this.offset += gap;
		this.lastGap = gap;
	}
	finalize() {
		this.flushGroup();
		return {
			entries: this.entries,
			totalDuration: Math.max(0, this.offset - this.lastGap)
		};
	}
	flushGroup() {
		if (this.group.length === 0) return;
		const group = this.group;
		const bodyStarts = new Array(group.length);
		let cursor = this.offset;
		for (let i = 0; i < group.length; i++) {
			bodyStarts[i] = cursor;
			cursor += group[i].bodyDuration;
			if (i < group.length - 1) cursor += this.glyphGap;
		}
		const bodyEnd = cursor;
		const hasAnyDots = group.some((p) => p.dotIndices.length > 0);
		const dotStarts = new Array(group.length);
		let groupEnd = bodyEnd;
		if (hasAnyDots) {
			cursor = bodyEnd + this.glyphGap;
			for (let i = 0; i < group.length; i++) {
				const p = group[i];
				if (p.dotIndices.length === 0) continue;
				dotStarts[i] = cursor;
				cursor += p.dotDuration + this.glyphGap;
			}
			groupEnd = cursor - this.glyphGap;
		}
		for (let i = 0; i < group.length; i++) {
			const p = group[i];
			const bodyStart = bodyStarts[i];
			const dotStart = dotStarts[i];
			let strokeDelays;
			let endTime = bodyStart + p.bodyDuration;
			if (dotStart !== void 0 && p.dotIndices.length > 0) {
				strokeDelays = [];
				for (let k = 0; k < p.dotIndices.length; k++) {
					const strokeIdx = p.dotIndices[k];
					strokeDelays[strokeIdx] = dotStart - bodyStart + (p.dotDelays[k] - p.dotMinD);
				}
				endTime = dotStart + p.dotDuration;
			}
			this.entries.push({
				...p.fields,
				offset: bodyStart,
				duration: endTime - bodyStart,
				...strokeDelays ? { strokeDelays } : {}
			});
		}
		this.group.length = 0;
		this.offset = groupEnd;
		this.lastGap = 0;
	}
};
function computeGraphemeTimeline(text, font, config) {
	const glyphGap = config?.glyphGap ?? DEFAULTS.glyphGap;
	const wordGap = config?.wordGap ?? DEFAULTS.wordGap;
	const lineGap = config?.lineGap ?? DEFAULTS.lineGap;
	const unknownDuration = config?.unknownDuration ?? DEFAULTS.unknownDuration;
	const deferDots = config?.deferDots ?? DEFAULTS.deferDots;
	const chars = graphemes(text);
	if (config?.stagger) {
		const staticDur = config.stagger.duration === "auto" || config.stagger.duration === void 0 ? void 0 : config.stagger.duration;
		const sched = new StaggerScheduler(wordGap, lineGap, config.stagger.advance, staticDur);
		for (let i = 0; i < chars.length; i++) {
			const char = chars[i];
			const isLineBreak = char === "\n";
			const isWhitespace = !isLineBreak && /^\s+$/.test(char);
			if (isLineBreak) {
				sched.separator("line");
				continue;
			}
			if (isWhitespace) {
				sched.addMarker({
					char,
					graphemeIndex: i,
					hasGlyph: false
				});
				sched.separator("word");
				continue;
			}
			const glyph = lookupGlyphData(font, char);
			if (glyph) sched.addGlyph({
				char,
				graphemeIndex: i,
				hasGlyph: true
			}, glyph.t ?? unknownDuration);
			else sched.addGlyph({
				char,
				graphemeIndex: i,
				hasGlyph: false
			}, unknownDuration);
		}
		return sched.finalize();
	}
	const sched = new Scheduler(glyphGap, wordGap, lineGap);
	for (let i = 0; i < chars.length; i++) {
		const char = chars[i];
		const isLineBreak = char === "\n";
		const isWhitespace = !isLineBreak && /^\s+$/.test(char);
		if (isLineBreak) {
			sched.separate("line");
			continue;
		}
		if (isWhitespace) {
			sched.separate("word", {
				fields: {
					char,
					graphemeIndex: i,
					hasGlyph: false
				},
				duration: 0
			});
			continue;
		}
		const glyph = lookupGlyphData(font, char);
		if (glyph) {
			const part = partitionGlyph(glyph, unknownDuration, deferDots);
			sched.add({
				fields: {
					char,
					graphemeIndex: i,
					hasGlyph: true
				},
				bodyDuration: part.bodyDuration,
				dotDuration: part.dotDuration,
				dotMinD: part.dotMinD,
				dotIndices: part.dotIndices,
				dotDelays: part.dotDelays
			});
		} else sched.add({
			fields: {
				char,
				graphemeIndex: i,
				hasGlyph: false
			},
			bodyDuration: unknownDuration,
			dotDuration: 0,
			dotMinD: 0,
			dotIndices: [],
			dotDelays: []
		});
	}
	return sched.finalize();
}
function computeShapedTimeline(text, font, config, shaper) {
	const glyphGap = config?.glyphGap ?? DEFAULTS.glyphGap;
	const wordGap = config?.wordGap ?? DEFAULTS.wordGap;
	const lineGap = config?.lineGap ?? DEFAULTS.lineGap;
	const unknownDuration = config?.unknownDuration ?? DEFAULTS.unknownDuration;
	const deferDots = config?.deferDots ?? DEFAULTS.deferDots;
	const chars = graphemes(text);
	const utf16ToGrapheme = new Int32Array(text.length + 1).fill(-1);
	{
		let u = 0;
		for (let i = 0; i < chars.length; i++) {
			utf16ToGrapheme[u] = i;
			u += chars[i].length;
		}
		utf16ToGrapheme[text.length] = chars.length;
	}
	const staggerSched = config?.stagger ? new StaggerScheduler(wordGap, lineGap, config.stagger.advance, config.stagger.duration === "auto" || config.stagger.duration === void 0 ? void 0 : config.stagger.duration) : null;
	const sched = staggerSched ? null : new Scheduler(glyphGap, wordGap, lineGap);
	let lineStart = 0;
	for (let i = 0; i <= text.length; i++) {
		const atEnd = i === text.length;
		if (!atEnd && text[i] !== "\n") continue;
		const lineText = text.slice(lineStart, i);
		if (lineText.length > 0) {
			const shaped = shaper.shape(lineText);
			const order = shaped.map((_, idx) => idx);
			order.sort((a, b) => shaped[a].cl - shaped[b].cl || a - b);
			for (let k = 0; k < order.length; k++) {
				const glyph = shaped[order[k]];
				const clusterStart = lineStart + glyph.cl;
				const nextOrder = k + 1 < order.length ? order[k + 1] : -1;
				const clusterEnd = nextOrder >= 0 ? lineStart + shaped[nextOrder].cl : i;
				const graphemeIdx = utf16ToGrapheme[clusterStart] ?? -1;
				if (graphemeIdx < 0) continue;
				const clusterText = text.slice(clusterStart, clusterEnd);
				const firstChar = chars[graphemeIdx];
				const isWhitespace = /^\s+$/.test(clusterText);
				const data = font.glyphDataById?.[glyph.g] ?? lookupGlyphData(font, firstChar);
				const hasGlyph = !!data;
				if (isWhitespace) {
					if (staggerSched) {
						staggerSched.addMarker({
							char: firstChar,
							graphemeIndex: graphemeIdx,
							glyphId: glyph.g,
							hasGlyph
						});
						staggerSched.separator("word");
					} else sched.separate("word", {
						fields: {
							char: firstChar,
							graphemeIndex: graphemeIdx,
							glyphId: glyph.g,
							hasGlyph
						},
						duration: 0
					});
					continue;
				}
				if (staggerSched) {
					const bundled = hasGlyph && data ? data.t ?? unknownDuration : unknownDuration;
					staggerSched.addGlyph({
						char: firstChar,
						graphemeIndex: graphemeIdx,
						glyphId: glyph.g,
						hasGlyph: !!(hasGlyph && data)
					}, bundled);
				} else if (hasGlyph && data) {
					const part = partitionGlyph(data, unknownDuration, deferDots);
					sched.add({
						fields: {
							char: firstChar,
							graphemeIndex: graphemeIdx,
							glyphId: glyph.g,
							hasGlyph: true
						},
						bodyDuration: part.bodyDuration,
						dotDuration: part.dotDuration,
						dotMinD: part.dotMinD,
						dotIndices: part.dotIndices,
						dotDelays: part.dotDelays
					});
				} else sched.add({
					fields: {
						char: firstChar,
						graphemeIndex: graphemeIdx,
						glyphId: glyph.g,
						hasGlyph: false
					},
					bodyDuration: unknownDuration,
					dotDuration: 0,
					dotMinD: 0,
					dotIndices: [],
					dotDelays: []
				});
			}
		}
		if (!atEnd) {
			if (staggerSched) staggerSched.separator("line");
			else sched.separate("line");
			lineStart = i + 1;
		}
	}
	return staggerSched ? staggerSched.finalize() : sched.finalize();
}
//#endregion
//#region src/lib/textToSvg.ts
/**
* Lay text out left-to-right from the bundle's advance widths — the headless
* analogue of the DOM-measured `computeTextLayout`. Lines break only on `\n`
* (no auto-wrap). Sufficient for the no-shaper Latin/CJK path the CLI targets;
* complex-script GPOS positioning (Arabic cursive joins, Indic conjuncts) needs
* the browser shaper and is not modelled here.
*/
function headlessLayout(text, font) {
	const chars = graphemes(text);
	const upm = font.unitsPerEm;
	const lines = [];
	const charOffsets = new Array(chars.length).fill(0);
	let current = [];
	let penEm = 0;
	let maxRightEm = 0;
	for (let i = 0; i < chars.length; i++) {
		const ch = chars[i];
		if (ch === "\n") {
			charOffsets[i] = 0;
			current.push(i);
			lines.push(current);
			current = [];
			penEm = 0;
			continue;
		}
		charOffsets[i] = penEm;
		const glyph = lookupGlyphData(font, ch);
		const widthEm = glyph?.w != null ? glyph.w / upm : .5;
		penEm += widthEm;
		if (penEm > maxRightEm) maxRightEm = penEm;
		current.push(i);
	}
	if (current.length) lines.push(current);
	return {
		lines,
		charOffsets,
		maxRightEm
	};
}
/**
* Render text to a standalone SVG string headlessly — no DOM, no canvas. Reuses
* the same pure timeline + serializer the engine's `toSVG()` does, but derives
* glyph positions from the bundle's advance widths instead of a measured DOM
* overlay. This is what the `tegaki` CLI calls.
*
* Variable stroke width (`pressure`) is honoured in `once` / `static`; `loop`
* is constant width by construction. Glow, wobble, gradient, taper, and
* clip-to-text effects are not modelled in SVG.
*/
function textToSvg(text, font, options = {}) {
	const fontSize = options.fontSize ?? 100;
	const mode = options.mode ?? "loop";
	const color = options.color ?? "#1a1a1a";
	const animated = mode !== "static";
	const loop = mode === "loop";
	const upm = font.unitsPerEm;
	const scale = fontSize / upm;
	const emHeightPx = (font.ascender - font.descender) / upm * fontSize;
	const lineHeight = options.lineHeight ?? emHeightPx;
	const padH = PADDING_H_EM * fontSize;
	const padV = Math.max(MIN_PADDING_V_EM * fontSize, (MIN_LINE_HEIGHT_EM * fontSize - lineHeight) / 2);
	const halfLeading = (lineHeight - emHeightPx) / 2;
	const timeline = computeTimeline(text, font, options.timing, null);
	const { lines, charOffsets, maxRightEm } = headlessLayout(text, font);
	const totalChars = charOffsets.length;
	const graphemeToLine = new Int32Array(totalChars).fill(-1);
	for (let li = 0; li < lines.length; li++) for (const charIdx of lines[li]) graphemeToLine[charIdx] = li;
	const pressure = loop ? 0 : Math.max(0, Math.min(options.pressure ?? 1, 1));
	const smoothing = options.smoothing === true;
	const resolvedSegmentSize = options.segmentSize ?? (pressure > 0 || smoothing ? 2 : void 0);
	const segmentLengthFU = resolvedSegmentSize != null ? resolvedSegmentSize / scale : Infinity;
	const placements = [];
	for (const entry of timeline.entries) {
		if (entry.char === "\n" || !entry.hasGlyph) continue;
		const charIdx = entry.graphemeIndex;
		const lineIdx = charIdx < totalChars ? graphemeToLine[charIdx] : -1;
		if (lineIdx < 0) continue;
		const glyph = (entry.glyphId !== void 0 ? font.glyphDataById?.[entry.glyphId] : void 0) ?? lookupGlyphData(font, entry.char);
		if (!glyph) continue;
		const x = (charOffsets[charIdx] ?? 0) * fontSize;
		const glyphY = lineIdx * lineHeight + halfLeading;
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
		width: padH * 2 + maxRightEm * fontSize,
		height: padV * 2 + lines.length * lineHeight,
		lineCap: font.lineCap,
		color,
		pressure,
		segmentLengthFU,
		smoothing,
		strokeScale: 1,
		animated,
		loop,
		totalDuration: timeline.totalDuration
	});
}
//#endregion
export { CSS_PROGRESS as a, MIN_PADDING_V_EM as c, coerceToString as d, cssFontFamily as f, subdivideStroke as g, resolveCSSLength as h, CSS_DURATION as i, PADDING_H_EM as l, lookupGlyphData as m, computeTimeline as n, CSS_TIME as o, graphemes as p, placementsToSvg as r, MIN_LINE_HEIGHT_EM as s, textToSvg as t, registerCssProperties as u };

//# sourceMappingURL=textToSvg-GTQMM8Le.mjs.map