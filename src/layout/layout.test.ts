import { describe, expect, it } from 'vitest';
import { parse } from '../model/parse';
import { buildGlyph, filletTangentDistance } from './glyph';
import { DEFAULT_LAYOUT, layoutScore, type Primitive, tipYMapper } from './layout';

const layout = (src: string, opts = {}) => {
	const { score, diagnostics } = parse(src);
	expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
	return { score, result: layoutScore(score, opts) };
};

const ofType = <T extends Primitive['type']>(prims: Primitive[], type: T) =>
	prims.filter((p): p is Extract<Primitive, { type: T }> => p.type === type);

describe('glyph geometry', () => {
	const m = { width: 14, height: 28, radius: 7 };

	it('attaches a single U at the top of its curve', () => {
		const g = buildGlyph(100, 1, [{ bottom: 150, root: false }], m);
		expect(g.attachY).toBe(143);
		expect(g.top).toBe(122);
	});

	it('gives the root a square bottom and attaches at the corner', () => {
		const g = buildGlyph(100, -1, [{ bottom: 150, root: true }], m);
		expect(g.attachY).toBe(150);
		expect(g.fill).not.toContain('A');
	});

	it('fillets a slanted double with the same radius at both corners', () => {
		const g = buildGlyph(0, 1, [{ bottom: 170, root: false }, { bottom: 160, root: false }], m);
		// Inner corner is acute, so its tangent points sit further from the vertex than the outer one's.
		const u = { x: 28, y: -10 };
		const inner = Math.acos(-u.y / Math.hypot(u.x, u.y));
		expect(g.attachY).toBeCloseTo(170 - filletTangentDistance(7, inner), 5);
		expect(g.fill.match(/A7 7/g)).toHaveLength(2);
	});

	it('gives a root pair a sharp point at the inner corner', () => {
		const g = buildGlyph(0, 1, [{ bottom: 170, root: true }, { bottom: 160, root: false }], m);
		expect(g.attachY).toBe(170);
		expect(g.fill.match(/A/g)).toHaveLength(1);
	});
});

describe('layout', () => {
	it('spaces events proportionally when there is room', () => {
		const { result } = layout('3/4 5 4 2');
		const stems = ofType(result.systems[0]!.primitives, 'stem').map((s) => s.x);
		const gaps = stems.slice(1).map((x, i) => x - stems[i]!);
		for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!, 5);
	});

	it('keeps the minimum gap and stretches later time', () => {
		// Right-hand note followed by a left-hand note a 32nd later: needs two glyph widths plus the gap.
		const o = { ...DEFAULT_LAYOUT, width: 2000 };
		const { result } = layout('3/32 4/32 r/16 r/4 r/2', o);
		const stems = ofType(result.systems[0]!.primitives, 'stem').map((s) => s.x);
		expect(stems[1]! - stems[0]!).toBeGreaterThanOrEqual(2 * o.glyphWidth + o.minGap - 1e-9);
	});

	it('ends every stem at or above its glyphs', () => {
		const { score, result } = layout('1L+3/4 1R+3/8 5 4/16 6 r/8 1\'+2\'/4');
		const system = result.systems[0]!;
		const tipY = tipYMapper(score.tuning, DEFAULT_LAYOUT);
		for (const s of ofType(system.primitives, 'stem')) {
			const ev = score.events[s.event]!;
			if (ev.kind !== 'notes') throw new Error('stem on a rest');
			const lowestTip = Math.max(...ev.notes.map((n) => system.top + tipY(n.tine.length)));
			expect(s.y2).toBeLessThanOrEqual(lowestTip + 1e-9);
			expect(s.y2).toBeGreaterThan(s.y1);
		}
	});

	it('beams eighths and sixteenths within a beat and flags lone ones', () => {
		const { result } = layout('3/8 5 4/16 6 r/8 3/8 r/8 r/2');
		const prims = result.systems[0]!.primitives;
		expect(ofType(prims, 'beam')).toHaveLength(3); // one eighth beam, two sixteenth beams
		expect(ofType(prims, 'flag')).toHaveLength(1);
	});

	it('breaks lines on bars and justifies all but the last', () => {
		const src = Array.from({ length: 12 }, () => '3/4 5 4 2 |').join(' ');
		const { result } = layout(src, { width: 700 });
		expect(result.systems.length).toBeGreaterThan(1);
		const first = result.systems[0]!;
		const bars = ofType(first.primitives, 'barline').map((b) => b.x);
		expect(bars[bars.length - 1]).toBeCloseTo(700 - DEFAULT_LAYOUT.marginX, 5);
	});

	it('requires the time anchors to increase', () => {
		const { result } = layout('1L+3/4 1R+3/8 5 4/16 6 r/8 1\'+2\'/4 | 3/1');
		for (const s of result.systems) {
			for (let i = 1; i < s.anchors.length; i++) {
				expect(s.anchors[i]!.tick).toBeGreaterThan(s.anchors[i - 1]!.tick);
				expect(s.anchors[i]!.x).toBeGreaterThan(s.anchors[i - 1]!.x);
			}
		}
	});

	it('puts larger numbers beneath the glyphs inside the staff', () => {
		const { score, result } = layout("1L+3/4 1R+3/8 5 1'+2'/4", { labels: 'below' });
		const system = result.systems[0]!;
		const bottomLine = system.top + system.height;
		const tipY = tipYMapper(score.tuning, { ...DEFAULT_LAYOUT, labels: 'below' });
		for (const l of ofType(system.primitives, 'label')) {
			expect(l.placement).toBe('below');
			expect(l.size).toBe(DEFAULT_LAYOUT.belowLabelSize);
			expect(l.y + l.size / 2).toBeLessThanOrEqual(bottomLine);
		}
		// Tines keep the same spread; the staff grows to make room for the numbers.
		expect(system.height).toBeGreaterThan(DEFAULT_LAYOUT.staffHeight);
		expect(tipY(1)).toBe(tipYMapper(score.tuning, DEFAULT_LAYOUT)(1) - (system.height - DEFAULT_LAYOUT.staffHeight));
	});
});
