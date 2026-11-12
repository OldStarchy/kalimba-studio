import { barTicks, PPQ, type Score } from '../model/score';
import { audio, click, PAN_WIDTH, pluck } from './engine';

export interface PlaybackHandle {
	stop(): void;
}

export interface PlayOptions {
	tempo: number;
	/** Start from this tick instead of the beginning. */
	startTick?: number;
	/** Click on every beat, accenting bar starts. */
	metronome?: boolean;
}

/**
 * Plays a score. `onTick` is called every animation frame with the current position in ticks,
 * and with `null` when playback ends or is stopped.
 */
export function play(score: Score, o: PlayOptions, onTick: (tick: number | null) => void): PlaybackHandle {
	const { ctx, out } = audio();
	const session = ctx.createGain();
	session.connect(out);

	const startTick = Math.max(0, Math.min(o.startTick ?? 0, score.totalTicks));
	const secondsPerTick = 60 / o.tempo / PPQ;
	const start = ctx.currentTime + 0.08;
	const at = (tick: number) => start + (tick - startTick) * secondsPerTick;

	for (const ev of score.events) {
		if (ev.kind !== 'notes' || ev.tick < startTick) continue;
		for (const note of ev.notes) pluck(note.tine.midi, note.tine.position * PAN_WIDTH, at(ev.tick), session);
	}

	if (o.metronome) {
		const beat = (PPQ * 4) / score.time.unit;
		const bar = barTicks(score.time);
		for (let t = Math.ceil(startTick / beat) * beat; t < score.totalTicks; t += beat) click(at(t), t % bar === 0, session);
	}

	const endTime = at(score.totalTicks) + 0.15;
	let frame = 0;
	let stopped = false;
	const loop = () => {
		if (stopped) return;
		if (ctx.currentTime >= endTime) {
			end(0.5);
			return;
		}
		onTick(Math.max(startTick, startTick + (ctx.currentTime - start) / secondsPerTick));
		frame = requestAnimationFrame(loop);
	};
	frame = requestAnimationFrame(loop);

	function end(fade: number) {
		if (stopped) return;
		stopped = true;
		cancelAnimationFrame(frame);
		onTick(null);
		session.gain.setTargetAtTime(0, ctx.currentTime, fade / 4);
		setTimeout(() => session.disconnect(), fade * 1000 + 500);
	}

	return { stop: () => end(0.08) };
}
