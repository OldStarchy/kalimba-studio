import { midiToFrequency } from '../model/tuning';

/** How far the widest tines are panned. Full ±1 sounds odd for an instrument held at arm's length. */
export const PAN_WIDTH = 0.4;
/** Ratio of a clamped-free bar's second bending mode to its first. Gives the metallic upper partial. */
const SECOND_MODE = 6.267;

interface Engine {
	ctx: AudioContext;
	out: AudioNode;
}

let engine: Engine | null = null;

/**
 * The shared audio context. Browsers only allow audio after a user gesture,
 * so call this from an event handler the first time.
 */
export function audio(): Engine {
	if (!engine) {
		const ctx = new AudioContext({ latencyHint: 'interactive' });
		const comp = ctx.createDynamicsCompressor();
		const master = ctx.createGain();
		master.gain.value = 0.6;
		master.connect(comp).connect(ctx.destination);
		engine = { ctx, out: master };
	}
	if (engine.ctx.state === 'suspended') void engine.ctx.resume();
	return engine;
}

/** A plucked tine: a sine fundamental plus a fast-decaying upper partial. */
export function pluck(midi: number, pan: number, when?: number, dest?: AudioNode) {
	const { ctx, out } = audio();
	const t = when ?? ctx.currentTime;
	const f = midiToFrequency(midi);
	// Low tines ring longer.
	const decay = Math.min(4, Math.max(1, 2.6 * Math.sqrt(261.6 / f)));

	const panner = ctx.createStereoPanner();
	panner.pan.value = pan;
	panner.connect(dest ?? out);

	const fundamental = ctx.createOscillator();
	fundamental.frequency.value = f;
	const g1 = ctx.createGain();
	g1.gain.setValueAtTime(0, t);
	g1.gain.linearRampToValueAtTime(0.35, t + 0.004);
	g1.gain.exponentialRampToValueAtTime(0.0001, t + decay);
	fundamental.connect(g1).connect(panner);

	const partial = ctx.createOscillator();
	partial.frequency.value = f * SECOND_MODE;
	const g2 = ctx.createGain();
	g2.gain.setValueAtTime(0, t);
	g2.gain.linearRampToValueAtTime(0.08, t + 0.002);
	g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
	partial.connect(g2).connect(panner);

	fundamental.start(t);
	partial.start(t);
	fundamental.stop(t + decay + 0.05);
	partial.stop(t + 0.25);
	fundamental.onended = () => panner.disconnect();
}

/** A short woodblock-ish click; accented on the first beat of the bar. */
export function click(when: number, accent: boolean, dest?: AudioNode) {
	const { ctx, out } = audio();
	const osc = ctx.createOscillator();
	osc.type = 'triangle';
	osc.frequency.value = accent ? 1760 : 1175;
	const g = ctx.createGain();
	g.gain.setValueAtTime(0, when);
	g.gain.linearRampToValueAtTime(accent ? 0.45 : 0.28, when + 0.001);
	g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
	osc.connect(g).connect(dest ?? out);
	osc.start(when);
	osc.stop(when + 0.06);
}
