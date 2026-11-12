import { audio, click } from './engine';

export interface MetronomeOptions {
	/** Audio-clock time of beat 0. */
	startTime: number;
	beatSeconds: number;
	beatsPerBar: number;
	/** Called (on the main thread, close to when it sounds) for each beat, with the beat's index from beat 0. */
	onBeat?: (beatIndex: number) => void;
}

const LOOKAHEAD = 0.12;
const INTERVAL_MS = 25;

/** A lookahead-scheduled click track that runs until stopped. */
export class Metronome {
	private timer: ReturnType<typeof setInterval> | null = null;
	private timeouts: ReturnType<typeof setTimeout>[] = [];
	private beat = 0;

	start(o: MetronomeOptions) {
		this.stop();
		const { ctx } = audio();
		this.beat = 0;
		const schedule = () => {
			for (;;) {
				const when = o.startTime + this.beat * o.beatSeconds;
				if (when >= ctx.currentTime + LOOKAHEAD) break;
				if (when >= ctx.currentTime - 0.01) {
					click(when, this.beat % o.beatsPerBar === 0);
					const index = this.beat;
					if (o.onBeat) this.timeouts.push(setTimeout(() => o.onBeat?.(index), Math.max(0, (when - ctx.currentTime) * 1000)));
				}
				this.beat++;
			}
		};
		schedule();
		this.timer = setInterval(schedule, INTERVAL_MS);
	}

	stop() {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		for (const t of this.timeouts) clearTimeout(t);
		this.timeouts = [];
	}

	get running() {
		return this.timer !== null;
	}
}
