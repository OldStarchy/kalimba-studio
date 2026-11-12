import { type Note, PPQ, type Score, type ScoreEvent, valueToTicks } from './score';
import type { Side, Tine } from './tuning';

/**
 * Edits on the text source, addressed by an event caret: caret `i` sits just before event `i`,
 * and caret `events.length` sits after the last event. The text stays the single source of truth,
 * so every edit here is ordinary text the user can see, undo, and keep editing.
 */

export interface EditResult {
	source: string;
	caret: number;
}

export interface Duration {
	value: number;
	dots: number;
}

export function durationSuffix({ value, dots }: Duration): string {
	return `/${value}${'.'.repeat(dots)}`;
}

/** Text for one key, e.g. `3`, `1L`, `2'`. Adds the side only where the tuning can't infer it. */
export function keyText(tine: Tine, side: Side): string {
	const marks = tine.octave > 0 ? "'".repeat(tine.octave) : ','.repeat(-tine.octave);
	const needsSide = tine.side === 'C' || tine.side !== side;
	return `${tine.degree}${marks}${needsSide ? side : ''}`;
}

export function chordText(notes: Note[]): string {
	// Left thumb first, each side inner to outer, so tokens read the same way the glyphs hang.
	const sorted = [...notes].sort(
		(a, b) => (a.side === b.side ? a.tine.rank - b.tine.rank : a.side === 'L' ? -1 : 1),
	);
	return sorted.map((n) => keyText(n.tine, n.side)).join('+');
}

export function tokenText(notes: Note[] | null, duration: Duration): string {
	return `${notes && notes.length ? chordText(notes) : 'r'}${durationSuffix(duration)}`;
}

function splice(source: string, offset: number, remove: number, insert: string): string {
	return source.slice(0, offset) + insert + source.slice(offset + remove);
}

/** Gives an event's token an explicit duration, so edits before it can't change what it inherits. */
function pinDuration(source: string, event: ScoreEvent): string {
	if (event.explicitDuration) return source;
	const end = event.span.offset + event.span.length;
	return splice(source, end, 0, durationSuffix(event));
}

/** Inserts whole tokens (each with an explicit duration) at a caret. */
export function insertTokens(source: string, score: Score, caret: number, tokens: string[]): EditResult {
	if (!tokens.length) return { source, caret };
	const events = score.events;
	const text = tokens.join(' ');

	if (caret < events.length) {
		const next = events[caret]!;
		// Pin first: it edits text after the insertion point, so the insertion offset stays valid.
		const pinned = pinDuration(source, next);
		return { source: splice(pinned, next.span.offset, 0, `${text} `), caret: caret + tokens.length };
	}

	const last = events[events.length - 1];
	if (last) {
		const end = last.span.offset + last.span.length;
		return { source: splice(source, end, 0, ` ${text}`), caret: caret + tokens.length };
	}
	const sep = source.length === 0 || source.endsWith('\n') ? '' : '\n';
	return { source: `${source}${sep}${text}\n`, caret: tokens.length };
}

/** Deletes the event at `index`, keeping the following event's duration unchanged. */
export function deleteEvent(source: string, score: Score, index: number): EditResult {
	const ev = score.events[index];
	if (!ev) return { source, caret: Math.min(index, score.events.length) };
	const next = score.events[index + 1];
	let out = next ? pinDuration(source, next) : source;

	let start = ev.span.offset;
	let end = start + ev.span.length;
	// Take one neighbouring space with it so tokens don't pile up gaps.
	if (out[end] === ' ') end++;
	else if (start > 0 && out[start - 1] === ' ') start--;
	out = splice(out, start, end - start, '');
	return { source: out, caret: index };
}

const PIECES: Duration[] = [
	{ value: 1, dots: 0 },
	{ value: 2, dots: 1 },
	{ value: 2, dots: 0 },
	{ value: 4, dots: 1 },
	{ value: 4, dots: 0 },
	{ value: 8, dots: 1 },
	{ value: 8, dots: 0 },
	{ value: 16, dots: 1 },
	{ value: 16, dots: 0 },
	{ value: 32, dots: 0 },
];

/** Splits a span of ticks into writable durations, longest first. Anything under a 32nd is dropped. */
export function decompose(ticks: number): Duration[] {
	const out: Duration[] = [];
	let left = ticks;
	while (left >= valueToTicks(32, 0)) {
		const piece = PIECES.find((p) => valueToTicks(p.value, p.dots) <= left)!;
		out.push(piece);
		left -= valueToTicks(piece.value, piece.dots);
	}
	return out;
}

export interface Tap {
	/** Seconds since recording time zero (negative during the count-in). */
	time: number;
	tine: Tine;
	side: Side;
}

export interface QuantiseOptions {
	tempo: number;
	/** Grid in ticks, e.g. PPQ / 4 for sixteenths. */
	grid: number;
	/** Seconds since time zero when recording stopped. */
	stopTime: number;
	/** Beat length in ticks; the last note is trimmed back to a beat boundary. Defaults to a quarter. */
	beat?: number;
}

/**
 * Turns timed taps into tokens. Taps snap to the grid; taps on the same grid point become one chord
 * (at most two keys per thumb, first come first served). Each note lasts until the next onset, with any
 * remainder that isn't a single writable duration written as rests.
 */
export function quantiseTaps(taps: Tap[], o: QuantiseOptions): string[] {
	const secondsPerTick = 60 / o.tempo / PPQ;
	const snap = (seconds: number) => Math.round(seconds / secondsPerTick / o.grid) * o.grid;

	const groups = new Map<number, Note[]>();
	for (const tap of [...taps].sort((a, b) => a.time - b.time)) {
		const tick = snap(tap.time);
		if (tick < 0) continue;
		const notes = groups.get(tick) ?? [];
		if (notes.some((n) => n.tine === tap.tine)) continue;
		if (notes.filter((n) => n.side === tap.side).length >= 2) continue;
		notes.push({ tine: tap.tine, side: tap.side });
		groups.set(tick, notes);
	}

	const onsets = [...groups.keys()].sort((a, b) => a - b);
	if (!onsets.length) return [];

	const tokens: string[] = [];
	for (const d of decompose(onsets[0]!)) tokens.push(tokenText(null, d));

	const lastOnset = onsets[onsets.length - 1]!;
	// The last note runs to the last beat boundary before recording stopped (people stop a little late),
	// at least one grid step and at most a whole note.
	const beat = o.beat ?? PPQ;
	const stopBeat = Math.floor(snap(o.stopTime) / beat) * beat;
	const end = Math.min(lastOnset + PPQ * 4, Math.max(lastOnset + o.grid, stopBeat));

	onsets.forEach((tick, i) => {
		const next = onsets[i + 1] ?? end;
		const [first, ...rest] = decompose(next - tick);
		tokens.push(tokenText(groups.get(tick)!, first ?? { value: 32, dots: 0 }));
		for (const d of rest) tokens.push(tokenText(null, d));
	});
	return tokens;
}

/** Tick at which a caret sits. */
export function caretTick(score: Score, caret: number): number {
	return score.events[caret]?.tick ?? score.totalTicks;
}
