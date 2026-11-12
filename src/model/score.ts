import type { Side, Tine, Tuning } from './tuning';

/** Ticks per quarter note. All timing is integer ticks so layout and beaming stay exact. */
export const PPQ = 480;

export interface SourceSpan {
	line: number;
	column: number;
	length: number;
}

export interface Note {
	tine: Tine;
	/** Which thumb plays it. Defaults to the tine's physical side; required for the centre tine. */
	side: Side;
}

interface EventBase {
	tick: number;
	/** Total duration in ticks, including dots. */
	duration: number;
	/** Undotted duration as a note value denominator: 1 = whole, 4 = quarter, 16 = sixteenth. */
	value: number;
	dots: number;
	span: SourceSpan;
}

export interface NoteEvent extends EventBase {
	kind: 'notes';
	notes: Note[];
}

export interface RestEvent extends EventBase {
	kind: 'rest';
}

export type ScoreEvent = NoteEvent | RestEvent;

export interface TimeSignature {
	beats: number;
	unit: number;
}

export interface Score {
	title?: string;
	composer?: string;
	/** Quarter notes per minute. */
	tempo: number;
	time: TimeSignature;
	tuning: Tuning;
	events: ScoreEvent[];
	totalTicks: number;
}

export interface Diagnostic {
	severity: 'error' | 'warning';
	message: string;
	span: SourceSpan;
}

export function valueToTicks(value: number, dots: number): number {
	const base = (PPQ * 4) / value;
	let total = base;
	let add = base;
	for (let i = 0; i < dots; i++) {
		add /= 2;
		total += add;
	}
	return total;
}

export function barTicks(time: TimeSignature): number {
	return (PPQ * 4 * time.beats) / time.unit;
}

/** The note value a beam group covers: a dotted quarter in compound time (6/8, 9/8, 12/8), otherwise one beat. */
export function beamUnitTicks(time: TimeSignature): number {
	if (time.unit === 8 && time.beats % 3 === 0 && time.beats > 3) return (PPQ * 3) / 2;
	return (PPQ * 4) / time.unit;
}

export function notesOnSide(event: NoteEvent, side: Side): Note[] {
	return event.notes.filter((n) => n.side === side);
}
