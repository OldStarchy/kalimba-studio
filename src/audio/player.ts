import { PPQ, type Score } from '../model/score';
import { midiToFrequency } from '../model/tuning';

/** How far the widest tines are panned. Full ±1 sounds odd for an instrument held at arm's length. */
const PAN_WIDTH = 0.4;
/** Ratio of a clamped-free bar's second bending mode to its first. Gives the metallic upper partial. */
const SECOND_MODE = 6.267;

export interface PlaybackHandle {
	stop(): void;
}

/**
 * Plays a score with a simple two-partial kalimba voice.
 * `onTick` is called every animation frame with the current position in ticks, and with `null` when playback ends.
 */
export function play(score: Score, tempo: number, onTick: (tick: number | null) => void): PlaybackHandle {
	const ctx = new AudioContext();
	const master = ctx.createGain();
	master.gain.value = 0.6;
	const comp = ctx.createDynamicsCompressor();
	master.connect(comp).connect(ctx.destination);

	const secondsPerTick = 60 / tempo / PPQ;
	const start = ctx.currentTime + 0.1;

	for (const ev of score.events) {
		if (ev.kind !== 'notes') continue;
		const t = start + ev.tick * secondsPerTick;
		for (const note of ev.notes) voice(ctx, master, t, note.tine.midi, note.tine.position * PAN_WIDTH);
	}

	const endTime = start + score.totalTicks * secondsPerTick + 0.2;
	let frame = 0;
	let stopped = false;
	const tickLoop = () => {
		if (stopped) return;
		const now = ctx.currentTime;
		if (now >= endTime) {
			finish();
			return;
		}
		onTick(Math.max(0, (now - start) / secondsPerTick));
		frame = requestAnimationFrame(tickLoop);
	};
	frame = requestAnimationFrame(tickLoop);

	function finish() {
		if (stopped) return;
		stopped = true;
		cancelAnimationFrame(frame);
		onTick(null);
		// Let the last notes ring out briefly before closing.
		master.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
		setTimeout(() => void ctx.close(), 2500);
	}

	return {
		stop() {
			if (stopped) return;
			stopped = true;
			cancelAnimationFrame(frame);
			onTick(null);
			master.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
			setTimeout(() => void ctx.close(), 200);
		},
	};
}

function voice(ctx: AudioContext, out: AudioNode, t: number, midi: number, pan: number) {
	const f = midiToFrequency(midi);
	// Low tines ring longer.
	const decay = Math.min(4, Math.max(1, 2.6 * Math.sqrt(261.6 / f)));

	const panner = ctx.createStereoPanner();
	panner.pan.value = pan;
	panner.connect(out);

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
}
