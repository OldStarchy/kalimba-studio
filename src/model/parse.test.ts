import { describe, expect, it } from 'vitest';
import { parse } from './parse';
import { PPQ } from './score';
import { C17 } from './tuning';

describe('C17 tuning', () => {
	it('has the centre tine as C4 and alternates outward', () => {
		const names = C17.tines.map((t) => `${t.degree}${"'".repeat(Math.max(t.octave, 0))}${t.side}`);
		expect(names).toEqual([
			"2''L", "7'L", "5'L", "3'L", "1'L", '6L', '4L', '2L', '1C', '3R', '5R', '7R', "2'R", "4'R", "6'R", "1''R", "3''R",
		]);
	});

	it('gets shorter as pitch rises', () => {
		const byPitch = [...C17.tines].sort((a, b) => a.midi - b.midi);
		for (let i = 1; i < byPitch.length; i++) expect(byPitch[i]!.length).toBeLessThan(byPitch[i - 1]!.length);
		expect(byPitch[0]!.length).toBe(1);
	});
});

describe('parse', () => {
	it('reads headers', () => {
		const { score, diagnostics } = parse('title: Test\ntempo: 120\ntime: 3/4\n1L/4');
		expect(diagnostics).toEqual([]);
		expect(score.title).toBe('Test');
		expect(score.tempo).toBe(120);
		expect(score.time).toEqual({ beats: 3, unit: 4 });
	});

	it('infers sides from the tuning and inherits durations', () => {
		const { score, diagnostics } = parse('3/8 2 4/4');
		expect(diagnostics).toEqual([]);
		expect(score.events.map((e) => [e.tick, e.duration])).toEqual([
			[0, PPQ / 2],
			[PPQ / 2, PPQ / 2],
			[PPQ, PPQ],
		]);
		const sides = score.events.map((e) => (e.kind === 'notes' ? e.notes[0]!.side : '-'));
		expect(sides).toEqual(['R', 'L', 'L']);
	});

	it('requires a side for the centre tine', () => {
		const { diagnostics } = parse('1/4');
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]!.severity).toBe('error');
		expect(diagnostics[0]!.message).toContain('1L or 1R');
	});

	it('distinguishes a split chord from a one-thumb double', () => {
		const { score } = parse('1L+3/4 1R+3/4');
		const [split, double] = score.events;
		expect(split?.kind === 'notes' && split.notes.map((n) => n.side)).toEqual(['L', 'R']);
		expect(double?.kind === 'notes' && double.notes.map((n) => n.side)).toEqual(['R', 'R']);
	});

	it('handles octaves, dots and rests', () => {
		const { score, diagnostics } = parse("1'+2'/4. r/8 3,/2");
		expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(1); // 3, is not on a C17
		expect(score.events[0]!.duration).toBe(PPQ * 1.5);
		expect(score.events[1]!.kind).toBe('rest');
		expect(score.totalTicks).toBe(PPQ * 4);
	});

	it('warns when a bar check misses', () => {
		const { diagnostics } = parse('3/4 3 3 | 3/4 3 3 3 |');
		// The short first bar puts every later bar check out too.
		expect(diagnostics).toHaveLength(2);
		expect(diagnostics[0]!.severity).toBe('warning');
		expect(diagnostics[0]!.span.column).toBe(9);
	});

	it('rejects three keys for one thumb and warns on non-adjacent pairs', () => {
		expect(parse('3+5+7/4').diagnostics[0]!.severity).toBe('error');
		const gap = parse('3+7/4').diagnostics;
		expect(gap).toHaveLength(1);
		expect(gap[0]!.severity).toBe('warning');
	});

	it('ignores comments', () => {
		expect(parse('3/4 # 5 nonsense').score.events).toHaveLength(1);
	});
});
