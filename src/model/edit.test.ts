import { describe, expect, it } from 'vitest';
import { chordText, decompose, deleteEvent, insertTokens, quantiseTaps, type Tap } from './edit';
import { parse } from './parse';
import { PPQ } from './score';
import { C17, findTine } from './tuning';

const tine = (degree: string, octave = 0) => findTine(C17, degree, octave)!;
const durations = (src: string) => parse(src).score.events.map((e) => e.duration);

describe('insertTokens', () => {
	it('inserts before an event and pins the duration it used to inherit', () => {
		const src = '3/4 5 4';
		const { score } = parse(src);
		const out = insertTokens(src, score, 1, ['2/8']);
		expect(out.source).toBe('3/4 2/8 5/4 4');
		expect(out.caret).toBe(2);
		expect(durations(out.source)).toEqual([PPQ, PPQ / 2, PPQ, PPQ]);
	});

	it('appends after the last event', () => {
		const src = 'title: x\n3/4 5\n';
		const out = insertTokens(src, parse(src).score, 2, ['1L/2']);
		expect(out.source).toBe('title: x\n3/4 5 1L/2\n');
		expect(out.caret).toBe(3);
	});

	it('starts a body when there are no events yet', () => {
		const out = insertTokens('tempo: 90', parse('tempo: 90').score, 0, ['3/4', '5/4']);
		expect(out.source).toBe('tempo: 90\n3/4 5/4\n');
		expect(parse(out.source).score.events).toHaveLength(2);
	});
});

describe('deleteEvent', () => {
	it('removes a token and keeps the next duration', () => {
		const src = '3/8 5 4/4';
		const out = deleteEvent(src, parse(src).score, 0);
		expect(out.source).toBe('5/8 4/4');
		expect(durations(out.source)).toEqual([PPQ / 2, PPQ]);
	});

	it('removes the last token', () => {
		const src = '3/4 5';
		expect(deleteEvent(src, parse(src).score, 1).source).toBe('3/4');
	});
});

describe('chordText', () => {
	it('only writes sides the tuning cannot infer', () => {
		expect(chordText([{ tine: tine('3'), side: 'R' }, { tine: tine('1'), side: 'L' }])).toBe('1L+3');
		expect(chordText([{ tine: tine('3'), side: 'R' }, { tine: tine('1'), side: 'R' }])).toBe('1R+3');
		expect(chordText([{ tine: tine('3'), side: 'L' }])).toBe('3L');
		expect(chordText([{ tine: tine('2', 1), side: 'R' }])).toBe("2'");
	});
});

describe('decompose', () => {
	it('splits into writable durations', () => {
		expect(decompose(PPQ * 1.5)).toEqual([{ value: 4, dots: 1 }]);
		expect(decompose(PPQ * 5 / 4)).toEqual([
			{ value: 4, dots: 0 },
			{ value: 16, dots: 0 },
		]);
	});
});

describe('quantiseTaps', () => {
	const tempo = 60; // one quarter per second
	const at = (time: number, degree: string, side: 'L' | 'R', octave = 0): Tap => ({ time, tine: tine(degree, octave), side });

	it('snaps taps to the grid and groups chords', () => {
		const taps = [at(0.02, '1', 'L'), at(0.03, '3', 'R'), at(0.99, '5', 'R'), at(1.52, '4', 'L')];
		const tokens = quantiseTaps(taps, { tempo, grid: PPQ / 4, stopTime: 2.1 });
		expect(tokens).toEqual(['1L+3/4', '5/8', '4/8']);
	});

	it('keeps leading silence as rests so the bar stays aligned', () => {
		const tokens = quantiseTaps([at(1.5, '3', 'R')], { tempo, grid: PPQ / 4, stopTime: 2 });
		expect(tokens).toEqual(['r/4.', '3/8']);
	});

	it('drops taps from the count-in that are well before time zero', () => {
		expect(quantiseTaps([at(-0.5, '3', 'R')], { tempo, grid: PPQ / 4, stopTime: 1 })).toEqual([]);
	});

	it('caps a thumb at two keys per onset', () => {
		const taps = [at(0, '3', 'R'), at(0.01, '5', 'R'), at(0.02, '7', 'R')];
		expect(quantiseTaps(taps, { tempo, grid: PPQ / 4, stopTime: 1 })).toEqual(['3+5/4']);
	});
});

describe('quantiseTaps end', () => {
	it('trims the last note back to the beat when stop comes a little late', () => {
		const t = (time: number): Tap => ({ time, tine: tine('5'), side: 'R' });
		expect(quantiseTaps([t(0), t(1)], { tempo: 60, grid: PPQ / 4, stopTime: 2.3 })).toEqual(['5/4', '5/4']);
	});
});
