import {
	barTicks,
	type Diagnostic,
	type Note,
	PPQ,
	type Score,
	type ScoreEvent,
	type SourceSpan,
	type TimeSignature,
	valueToTicks,
} from './score';
import { C17, findTine, type Side, type Tuning, TUNINGS } from './tuning';

export interface ParseResult {
	score: Score;
	diagnostics: Diagnostic[];
}

const HEADER_RE = /^\s*(title|composer|tempo|time|tuning)\s*:\s*(.*?)\s*$/i;
const TOKEN_RE = /^([^/]+?)(?:\/(\d+)(\.*))?$/;
const NOTE_RE = /^([1-7])([',]*)([LR]?)([',]*)$/;
const VALID_VALUES = new Set([1, 2, 4, 8, 16, 32]);

interface Token {
	text: string;
	span: SourceSpan;
}

function stripComment(line: string): string {
	const hash = line.indexOf('#');
	return hash === -1 ? line : line.slice(0, hash);
}

function octaveFromMarks(marks: string): number {
	let octave = 0;
	for (const c of marks) octave += c === "'" ? 1 : -1;
	return octave;
}

/**
 * Parses the kalimba text format.
 *
 * Header lines (`title:`, `composer:`, `tempo:`, `time:`, `tuning:`) may appear anywhere.
 * Everything else is a stream of whitespace-separated tokens:
 *
 * - `3/8`        key 3 for an eighth note
 * - `1L+3/4`     simultaneous keys joined with `+`; the centre tine needs `L` or `R`
 * - `1'`         `'` raises an octave, `,` lowers one
 * - `5/4.`       dotted durations
 * - `4`          omitting the duration repeats the previous one
 * - `r/8`        rest
 * - `|`          bar check: warns if it doesn't fall on a bar boundary
 * - `# ...`      comment to end of line
 */
export function parse(source: string): ParseResult {
	const diagnostics: Diagnostic[] = [];
	const lines = source.split(/\r?\n/);

	let title: string | undefined;
	let composer: string | undefined;
	let tempo = 90;
	let time: TimeSignature = { beats: 4, unit: 4 };
	let tuning: Tuning = C17;

	const tokens: Token[] = [];
	const lineStarts: number[] = [];
	let runningOffset = 0;
	for (const l of lines) {
		lineStarts.push(runningOffset);
		runningOffset += l.length + 1;
	}

	lines.forEach((rawLine, lineIndex) => {
		const line = stripComment(rawLine);
		const header = HEADER_RE.exec(line);
		const lineNo = lineIndex + 1;
		if (header) {
			const key = header[1]!.toLowerCase();
			const value = header[2]!;
			const column = line.indexOf(value) + 1;
			const span: SourceSpan = {
				offset: lineStarts[lineIndex]! + column - 1,
				line: lineNo,
				column,
				length: Math.max(value.length, 1),
			};
			switch (key) {
				case 'title':
					title = value || undefined;
					break;
				case 'composer':
					composer = value || undefined;
					break;
				case 'tempo': {
					const n = Number(value);
					if (Number.isFinite(n) && n > 0) tempo = n;
					else diagnostics.push({ severity: 'error', message: `Tempo must be a positive number, got "${value}"`, span });
					break;
				}
				case 'time': {
					const m = /^(\d+)\s*\/\s*(\d+)$/.exec(value);
					const beats = m ? Number(m[1]) : NaN;
					const unit = m ? Number(m[2]) : NaN;
					if (m && beats > 0 && VALID_VALUES.has(unit)) time = { beats, unit };
					else diagnostics.push({ severity: 'error', message: `Time signature must look like 4/4 or 6/8, got "${value}"`, span });
					break;
				}
				case 'tuning': {
					const t = TUNINGS[value.toLowerCase()];
					if (t) tuning = t;
					else
						diagnostics.push({
							severity: 'error',
							message: `Unknown tuning "${value}". Available: ${Object.keys(TUNINGS).join(', ')}`,
							span,
						});
					break;
				}
			}
			return;
		}
		for (const m of line.matchAll(/\S+/g)) {
			tokens.push({
				text: m[0],
				span: { offset: lineStarts[lineIndex]! + m.index, line: lineNo, column: m.index + 1, length: m[0].length },
			});
		}
	});

	const events: ScoreEvent[] = [];
	const bar = barTicks(time);
	let tick = 0;
	let value = 4;
	let dots = 0;

	for (const token of tokens) {
		if (token.text === '|') {
			if (tick % bar !== 0) {
				const beatTicks = (PPQ * 4) / time.unit;
				const intoBar = (tick % bar) / beatTicks;
				diagnostics.push({
					severity: 'warning',
					message: `Bar line falls ${formatBeats(intoBar)} beats into the bar; a ${time.beats}/${time.unit} bar is ${time.beats} beats`,
					span: token.span,
				});
			}
			continue;
		}

		const m = TOKEN_RE.exec(token.text);
		if (!m) {
			diagnostics.push({ severity: 'error', message: `Can't read "${token.text}"`, span: token.span });
			continue;
		}
		const [, body, valueText, dotText] = m;
		if (valueText !== undefined) {
			const v = Number(valueText);
			if (!VALID_VALUES.has(v)) {
				diagnostics.push({
					severity: 'error',
					message: `Duration /${valueText} isn't supported; use /1, /2, /4, /8, /16 or /32`,
					span: token.span,
				});
				continue;
			}
			value = v;
			dots = dotText?.length ?? 0;
		}
		const duration = valueToTicks(value, dots);
		const base = { tick, duration, value, dots, explicitDuration: valueText !== undefined, span: token.span };
		tick += duration;

		if (body === 'r') {
			events.push({ kind: 'rest', ...base });
			continue;
		}

		const notes = parseChord(body!, tuning, token.span, diagnostics);
		if (notes) events.push({ kind: 'notes', notes, ...base });
	}

	return {
		score: { title, composer, tempo, time, tuning, events, totalTicks: tick },
		diagnostics,
	};
}

function formatBeats(n: number): string {
	return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '');
}

function parseChord(body: string, tuning: Tuning, span: SourceSpan, diagnostics: Diagnostic[]): Note[] | null {
	const notes: Note[] = [];
	let ok = true;
	for (const part of body.split('+')) {
		const m = NOTE_RE.exec(part);
		if (!m) {
			diagnostics.push({ severity: 'error', message: `"${part}" isn't a key. Keys look like 3, 1L, 5' or 2,`, span });
			ok = false;
			continue;
		}
		const [, degree, before, sideText, after] = m;
		const octave = octaveFromMarks(before! + after!);
		const tine = findTine(tuning, degree!, octave);
		if (!tine) {
			diagnostics.push({ severity: 'error', message: `"${part}" isn't on the ${tuning.name} kalimba`, span });
			ok = false;
			continue;
		}
		let side: Side;
		if (sideText) side = sideText as Side;
		else if (tine.side === 'C') {
			diagnostics.push({
				severity: 'error',
				message: `${part} is the centre tine, so it needs a side: write ${part}L or ${part}R`,
				span,
			});
			ok = false;
			continue;
		} else side = tine.side;

		if (notes.some((n) => n.tine === tine)) {
			diagnostics.push({ severity: 'error', message: `"${part}" appears twice in the same chord`, span });
			ok = false;
			continue;
		}
		notes.push({ tine, side });
	}
	if (!ok) return null;

	for (const side of ['L', 'R'] as const) {
		const onSide = notes.filter((n) => n.side === side);
		if (onSide.length > 2) {
			diagnostics.push({
				severity: 'error',
				message: `Three or more keys for the ${side === 'L' ? 'left' : 'right'} thumb at once`,
				span,
			});
			return null;
		}
		if (onSide.length === 2 && Math.abs(onSide[0]!.tine.rank - onSide[1]!.tine.rank) !== 1) {
			diagnostics.push({
				severity: 'warning',
				message: `${side === 'L' ? 'Left' : 'Right'}-thumb pair isn't on neighbouring tines, so one thumb can't sweep both`,
				span,
			});
		}
	}
	return notes;
}
