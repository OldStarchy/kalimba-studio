import {
	barTicks,
	beamUnitTicks,
	type Note,
	type NoteEvent,
	PPQ,
	type Score,
	type ScoreEvent,
} from '../model/score';
import type { Side, Tuning } from '../model/tuning';
import { buildGlyph, type GlyphColumn } from './glyph';

export interface LayoutOptions {
	/** Total width available for each system. */
	width: number;
	/** Nominal horizontal space per quarter note before any stretching. */
	pxPerQuarter: number;
	glyphWidth: number;
	glyphHeight: number;
	cornerRadius: number;
	/** Minimum clear space between neighbouring glyphs. */
	minGap: number;
	/** Extra clear space after a barline. */
	barPad: number;
	/** Distance between the two staff lines. */
	staffHeight: number;
	/** Space above the staff for the bar number, and between systems. */
	systemGap: number;
	marginX: number;
	/** Distance from the top staff line to the top of stems and the first beam. */
	stemTop: number;
	beamThickness: number;
	beamSpacing: number;
	/** Gridlines are drawn at the smallest of beat / two beats / bar that is at least this wide. */
	minGridPx: number;
	/** Systems are justified to full width unless that would stretch them more than this. */
	maxJustify: number;
	/** Key numbers inside the tine glyph, or larger beneath it. */
	labels: 'inside' | 'below';
	/** Font size for numbers placed beneath the glyph. Inside numbers are limited by the glyph width. */
	belowLabelSize: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
	width: 720,
	pxPerQuarter: 72,
	glyphWidth: 14,
	glyphHeight: 28,
	cornerRadius: 7,
	minGap: 6,
	barPad: 6,
	staffHeight: 160,
	systemGap: 36,
	marginX: 12,
	stemTop: 14,
	beamThickness: 3.5,
	beamSpacing: 6.5,
	minGridPx: 36,
	maxJustify: 1.6,
	labels: 'inside',
	belowLabelSize: 17,
};

const INSIDE_LABEL_SIZE = 12;
/** Worst-case room between a glyph's bottom and a number beneath it: a small gap plus two octave dots. */
const BELOW_DOT_RESERVE = 11;

/** Extra staff height needed below the lowest tine when numbers sit beneath the glyphs. */
function belowLabelSpace(o: LayoutOptions): number {
	return o.labels === 'below' ? BELOW_DOT_RESERVE + o.belowLabelSize * 0.8 : 0;
}

export type Primitive =
	| { type: 'staffLine'; x1: number; x2: number; y: number }
	| { type: 'barline'; x: number; y1: number; y2: number; final: boolean }
	| { type: 'grid'; x: number; y1: number; y2: number }
	| { type: 'barNumber'; x: number; y: number; text: string }
	| { type: 'glyph'; side: Side; fill: string; outline: string; hollow: boolean; event: number }
	| {
			type: 'label';
			x: number;
			y: number;
			size: number;
			placement: 'inside' | 'below';
			degree: string;
			octave: number;
			side: Side;
			hollow: boolean;
			event: number;
	  }
	| { type: 'stem'; x: number; y1: number; y2: number; event: number }
	| { type: 'beam'; x1: number; x2: number; y: number; thickness: number }
	| { type: 'flag'; x: number; y: number; event: number }
	| { type: 'rest'; x: number; y: number; value: number; event: number }
	| { type: 'dot'; x: number; y: number; event: number };

export interface TimeAnchor {
	tick: number;
	x: number;
}

export interface SystemLayout {
	top: number;
	height: number;
	startTick: number;
	endTick: number;
	primitives: Primitive[];
	/** (tick, x) points, increasing in both, for mapping time to position (gridlines, playback cursor). */
	anchors: TimeAnchor[];
}

export interface ScoreLayout {
	width: number;
	height: number;
	systems: SystemLayout[];
}

interface Anchor {
	tick: number;
	kind: 'bar' | 'event';
	event?: number;
	left: number;
	right: number;
	x: number;
}

const flagCount = (value: number) => (value >= 8 ? Math.log2(value / 4) : 0);

/** Notes on one side, inner (closest to the centre) first. */
export function sideColumns(notes: Note[], side: Side): Note[] {
	return notes
		.filter((n) => n.side === side)
		.sort((a, b) => a.tine.rank - b.tine.rank || b.tine.length - a.tine.length);
}

function extents(event: ScoreEvent, o: LayoutOptions): { left: number; right: number } {
	const dotSpace = event.dots > 0 ? 3 + event.dots * 5 : 0;
	if (event.kind === 'rest') return { left: 6, right: 6 + dotSpace };
	const left = sideColumns(event.notes, 'L').length * o.glyphWidth;
	const right = sideColumns(event.notes, 'R').length * o.glyphWidth;
	return { left, right: right + dotSpace };
}

/** Maps tine length to the y of its tip, relative to the top staff line. */
export function tipYMapper(tuning: Tuning, o: LayoutOptions): (length: number) => number {
	const lengths = tuning.tines.map((t) => t.length);
	const max = Math.max(...lengths);
	const min = Math.min(...lengths);
	const lowest = o.staffHeight - 8 - belowLabelSpace(o);
	const highest = o.stemTop + 3 * o.beamSpacing + o.glyphHeight + 6;
	return (length) => {
		const n = max === min ? 1 : (length - min) / (max - min);
		return highest + n * (lowest - highest);
	};
}

/**
 * Positions every event and barline on one infinitely long line.
 * Each anchor sits at its proportional time position plus the accumulated stretch,
 * pushed right just enough to keep `minGap` clear of the previous anchor.
 */
function placeAnchors(score: Score, o: LayoutOptions): Anchor[] {
	const bar = barTicks(score.time);
	const endTick = Math.max(bar, Math.ceil(score.totalTicks / bar) * bar);
	const anchors: Anchor[] = [];

	let e = 0;
	for (let barStart = 0; barStart <= endTick; barStart += bar) {
		anchors.push({ tick: barStart, kind: 'bar', left: 0, right: o.barPad, x: 0 });
		const barEnd = barStart + bar;
		while (e < score.events.length && score.events[e]!.tick < barEnd && barStart < endTick) {
			const ev = score.events[e]!;
			anchors.push({ tick: ev.tick, kind: 'event', event: e, ...extents(ev, o), x: 0 });
			e++;
		}
	}

	const pxPerTick = o.pxPerQuarter / PPQ;
	let prev: Anchor | undefined;
	for (const a of anchors) {
		const proportional = a.tick * pxPerTick + (prev ? prev.x - prev.tick * pxPerTick : 0);
		const minX = prev ? prev.x + prev.right + o.minGap + a.left : 0;
		a.x = Math.max(proportional, minX);
		prev = a;
	}
	return anchors;
}

function interpolate(anchors: TimeAnchor[], tick: number): number {
	let lo = anchors[0]!;
	let hi = anchors[anchors.length - 1]!;
	for (const a of anchors) {
		if (a.tick <= tick) lo = a;
		if (a.tick >= tick) {
			hi = a;
			break;
		}
	}
	if (hi.tick === lo.tick) return lo.x;
	return lo.x + ((tick - lo.tick) / (hi.tick - lo.tick)) * (hi.x - lo.x);
}

export function layoutScore(score: Score, options: Partial<LayoutOptions> = {}): ScoreLayout {
	const merged = { ...DEFAULT_LAYOUT, ...options };
	// Numbers beneath the glyphs get their own band at the bottom of the staff rather than squeezing the tines.
	const o = { ...merged, staffHeight: merged.staffHeight + belowLabelSpace(merged) };
	const anchors = placeAnchors(score, o);
	const bars = anchors.filter((a) => a.kind === 'bar');
	const bar = barTicks(score.time);
	const tipY = tipYMapper(score.tuning, o);

	// Greedy line breaking on whole bars.
	const available = o.width - 2 * o.marginX;
	const lines: number[][] = [];
	let current: number[] = [];
	let used = 0;
	for (let i = 0; i < bars.length - 1; i++) {
		const w = bars[i + 1]!.x - bars[i]!.x;
		if (current.length > 0 && used + w > available) {
			lines.push(current);
			current = [];
			used = 0;
		}
		current.push(i);
		used += w;
	}
	if (current.length) lines.push(current);

	const systems: SystemLayout[] = [];
	let top = o.systemGap;
	lines.forEach((barIndexes, lineIndex) => {
		const first = bars[barIndexes[0]!]!;
		const last = bars[barIndexes[barIndexes.length - 1]! + 1]!;
		const natural = last.x - first.x;
		const isLast = lineIndex === lines.length - 1;
		const justify = natural > 0 ? available / natural : 1;
		// Justify full lines (and a nearly-full last line). A bar too wide to fit even alone overflows
		// rather than squashing the minimum gaps.
		const shouldJustify = justify > 1 && justify <= (isLast ? 1.15 : o.maxJustify);
		const scale = shouldJustify ? justify : 1;
		const tx = (x: number) => o.marginX + (x - first.x) * scale;

		const inLine = anchors.filter((a) => a.tick >= first.tick && a.tick <= last.tick && (a.kind === 'event' ? a.tick < last.tick : true));
		const timeAnchors: TimeAnchor[] = [];
		for (const a of inLine) {
			const x = tx(a.x);
			// At a tick shared by a barline and an event, time "is" at the event's stem.
			const prevSame = timeAnchors[timeAnchors.length - 1];
			if (prevSame && prevSame.tick === a.tick) prevSame.x = a.kind === 'event' ? x : prevSame.x;
			else timeAnchors.push({ tick: a.tick, x });
		}

		const primitives = buildSystem(score, o, inLine, tx, tipY, top, isLast && last.tick >= score.totalTicks);
		const startTick = first.tick;
		const endTick = last.tick;

		// Gridlines: smallest of beat, two beats, bar whose average width is comfortable.
		const beat = (PPQ * 4) / score.time.unit;
		const systemWidth = tx(last.x) - tx(first.x);
		const pxPerTick = systemWidth / Math.max(1, endTick - startTick);
		const candidates = [beamUnitTicks(score.time), beat, beat * 2]
			.filter((c, i, arr) => bar % c === 0 && arr.indexOf(c) === i)
			.sort((a, b) => a - b);
		const unit = candidates.find((c) => c * pxPerTick >= o.minGridPx) ?? bar;
		if (unit < bar) {
			for (let t = startTick; t < endTick; t += unit) {
				if (t % bar === 0) continue;
				primitives.unshift({ type: 'grid', x: interpolate(timeAnchors, t), y1: top, y2: top + o.staffHeight });
			}
		}

		systems.push({ top, height: o.staffHeight, startTick, endTick, primitives, anchors: timeAnchors });
		top += o.staffHeight + o.systemGap;
	});

	const width = Math.max(o.width, ...systems.flatMap((s) => s.anchors.map((a) => a.x + o.marginX)));
	return { width, height: top, systems };
}

function buildSystem(
	score: Score,
	o: LayoutOptions,
	inLine: Anchor[],
	tx: (x: number) => number,
	tipY: (length: number) => number,
	top: number,
	finalBar: boolean,
): Primitive[] {
	const out: Primitive[] = [];
	const bar = barTicks(score.time);
	const bottom = top + o.staffHeight;
	const stemTopY = top + o.stemTop;
	const barAnchors = inLine.filter((a) => a.kind === 'bar');
	const x1 = tx(barAnchors[0]!.x);
	const x2 = tx(barAnchors[barAnchors.length - 1]!.x);

	out.push({ type: 'staffLine', x1, x2, y: top }, { type: 'staffLine', x1, x2, y: bottom });

	barAnchors.forEach((a, i) => {
		const isFinal = finalBar && i === barAnchors.length - 1;
		out.push({ type: 'barline', x: tx(a.x), y1: top, y2: bottom, final: isFinal });
	});
	out.push({ type: 'barNumber', x: tx(barAnchors[0]!.x), y: top - 8, text: String(barAnchors[0]!.tick / bar + 1) });

	const placed: { event: NoteEvent; index: number; x: number }[] = [];

	for (const a of inLine) {
		if (a.kind !== 'event') continue;
		const index = a.event!;
		const ev = score.events[index]!;
		const x = tx(a.x);

		if (ev.kind === 'rest') {
			out.push({ type: 'rest', x, y: top + o.staffHeight / 2, value: ev.value, event: index });
			for (let d = 0; d < ev.dots; d++) out.push({ type: 'dot', x: x + 9 + d * 5, y: top + o.staffHeight / 2 - 4, event: index });
			continue;
		}

		const hollow = ev.value <= 2;
		let attachY = -Infinity;
		let glyphTop = Infinity;
		for (const side of ['L', 'R'] as const) {
			const notes = sideColumns(ev.notes, side);
			if (!notes.length) continue;
			const dir = side === 'L' ? -1 : 1;
			const columns: GlyphColumn[] = notes.map((n) => ({ bottom: top + tipY(n.tine.length), root: n.tine.side === 'C' }));
			const g = buildGlyph(x, dir, columns, { width: o.glyphWidth, height: o.glyphHeight, radius: o.cornerRadius });
			out.push({ type: 'glyph', side, fill: g.fill, outline: g.outline, hollow, event: index });
			notes.forEach((n, col) => {
				out.push({
					type: 'label',
					x: x + dir * o.glyphWidth * (col + 0.5),
					y:
						o.labels === 'below'
							? // Tuck the number up under the glyph, leaving room only for the octave dots it actually has.
								g.columnBottoms[col]! + 3 + Math.max(0, n.tine.octave) * 4 + o.belowLabelSize * 0.4
							: g.columnBottoms[col]! - 8.5,
					size: o.labels === 'below' ? o.belowLabelSize : INSIDE_LABEL_SIZE,
					placement: o.labels,
					degree: n.tine.degree,
					octave: n.tine.octave,
					side,
					hollow,
					event: index,
				});
			});
			attachY = Math.max(attachY, g.attachY);
			glyphTop = Math.min(glyphTop, g.top);
		}

		// Whole notes keep only the short divider between the glyphs; everything else reaches the beam line.
		const stemStart = ev.value === 1 ? glyphTop : stemTopY;
		out.push({ type: 'stem', x, y1: stemStart, y2: attachY, event: index });

		const rightExtent = sideColumns(ev.notes, 'R').length * o.glyphWidth;
		for (let d = 0; d < ev.dots; d++) out.push({ type: 'dot', x: x + rightExtent + 5 + d * 5, y: glyphTop + 6, event: index });

		placed.push({ event: ev, index, x });
	}

	out.push(...beamsAndFlags(score, o, placed, stemTopY));
	return out;
}

function beamsAndFlags(
	score: Score,
	o: LayoutOptions,
	placed: { event: NoteEvent; index: number; x: number }[],
	stemTopY: number,
): Primitive[] {
	const out: Primitive[] = [];
	const unit = beamUnitTicks(score.time);

	// Runs of consecutive flagged notes in the same beam unit, broken by rests or unflagged notes.
	const runs: (typeof placed)[] = [];
	let run: typeof placed = [];
	let runUnit = -1;
	let lastIndex = -2;
	for (const p of placed) {
		const flags = flagCount(p.event.value);
		const u = Math.floor(p.event.tick / unit);
		const contiguous = p.index === lastIndex + 1 && u === runUnit;
		if (flags === 0) {
			if (run.length) runs.push(run);
			run = [];
		} else if (contiguous && run.length) {
			run.push(p);
		} else {
			if (run.length) runs.push(run);
			run = [p];
		}
		runUnit = u;
		lastIndex = p.index;
		// A rest between two notes breaks the run, because the note indexes are then not consecutive.
	}
	if (run.length) runs.push(run);

	for (const r of runs) {
		if (r.length === 1) {
			const p = r[0]!;
			for (let k = 0; k < flagCount(p.event.value); k++) out.push({ type: 'flag', x: p.x, y: stemTopY + k * o.beamSpacing, event: p.index });
			continue;
		}
		const maxFlags = Math.max(...r.map((p) => flagCount(p.event.value)));
		for (let level = 1; level <= maxFlags; level++) {
			const y = stemTopY + (level - 1) * o.beamSpacing;
			let i = 0;
			while (i < r.length) {
				if (flagCount(r[i]!.event.value) < level) {
					i++;
					continue;
				}
				let j = i;
				while (j + 1 < r.length && flagCount(r[j + 1]!.event.value) >= level) j++;
				if (j > i) {
					out.push({ type: 'beam', x1: r[i]!.x, x2: r[j]!.x, y, thickness: o.beamThickness });
				} else {
					// A lone note needing an extra beam gets a stub pointing at its neighbour.
					const neighbour = i === r.length - 1 ? r[i - 1]! : r[i + 1]!;
					const len = Math.min(10, Math.abs(neighbour.x - r[i]!.x) / 2);
					const x = r[i]!.x;
					const x2 = neighbour.x < x ? x - len : x + len;
					out.push({ type: 'beam', x1: Math.min(x, x2), x2: Math.max(x, x2), y, thickness: o.beamThickness });
				}
				i = j + 1;
			}
		}
	}
	return out;
}

/** Finds which system and x a tick falls at, for the playback cursor. */
export function positionAtTick(layout: ScoreLayout, tick: number): { system: SystemLayout; x: number } | undefined {
	const system = layout.systems.find((s) => tick >= s.startTick && tick < s.endTick) ?? layout.systems[layout.systems.length - 1];
	if (!system) return undefined;
	return { system, x: interpolate(system.anchors, Math.min(tick, system.endTick)) };
}
