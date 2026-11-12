/** Which thumb plays a note. */
export type Side = 'L' | 'R';

/** Where a tine sits on the instrument. The centre tine can be played by either thumb. */
export type TineSide = Side | 'C';

export interface Tine {
	/** Index in physical left-to-right order. */
	index: number;
	/** Scale degree label, e.g. "1".."7". */
	degree: string;
	/** Octave offset relative to the tuning's base octave (0 = no dots, 1 = one dot above, -1 = one dot below). */
	octave: number;
	/** MIDI note number. */
	midi: number;
	side: TineSide;
	/** Horizontal position on the instrument, -1 (far left) to +1 (far right). Used for panning. */
	position: number;
	/**
	 * Relative vibrating length, 1 = longest tine. Drives the vertical position on the staff.
	 * Defaults to the cantilever approximation L ∝ f^-1/2.
	 */
	length: number;
	/**
	 * Distance from the centre on this tine's side (0 = centre tine, 1 = next tine out, ...).
	 * Two tines can be played as a single-thumb double only if their ranks on that side differ by 1.
	 */
	rank: number;
}

export interface Tuning {
	id: string;
	name: string;
	/** Tines in physical left-to-right order. */
	tines: Tine[];
}

export function midiToFrequency(midi: number): number {
	return 440 * 2 ** ((midi - 69) / 12);
}

const DEGREE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

export interface TineSpec {
	degree: number;
	octave: number;
	/** Optional measured or custom relative length. */
	length?: number;
}

/**
 * Builds a tuning from tines listed in physical left-to-right order.
 * The tine at `centreIndex` is the centre tine; everything left of it is left-thumb, right of it right-thumb.
 */
export function buildTuning(
	id: string,
	name: string,
	tonicMidi: number,
	specs: TineSpec[],
	centreIndex: number,
): Tuning {
	const midis = specs.map(
		(s) => tonicMidi + 12 * s.octave + (DEGREE_SEMITONES[s.degree - 1] ?? 0),
	);
	const lowestFreq = Math.min(...midis.map(midiToFrequency));
	const maxOffset = Math.max(centreIndex, specs.length - 1 - centreIndex) || 1;

	const tines = specs.map((spec, index): Tine => {
		const midi = midis[index]!;
		const side: TineSide = index < centreIndex ? 'L' : index > centreIndex ? 'R' : 'C';
		return {
			index,
			degree: String(spec.degree),
			octave: spec.octave,
			midi,
			side,
			position: (index - centreIndex) / maxOffset,
			length: spec.length ?? Math.sqrt(lowestFreq / midiToFrequency(midi)),
			rank: Math.abs(index - centreIndex),
		};
	});

	return { id, name, tines };
}

/** Standard 17-key kalimba in C major: D6 B5 G5 E5 C5 A4 F4 D4 [C4] E4 G4 B4 D5 F5 A5 C6 E6. */
export const C17 = buildTuning(
	'c17',
	'17-key C major',
	60,
	[
		{ degree: 2, octave: 2 },
		{ degree: 7, octave: 1 },
		{ degree: 5, octave: 1 },
		{ degree: 3, octave: 1 },
		{ degree: 1, octave: 1 },
		{ degree: 6, octave: 0 },
		{ degree: 4, octave: 0 },
		{ degree: 2, octave: 0 },
		{ degree: 1, octave: 0 },
		{ degree: 3, octave: 0 },
		{ degree: 5, octave: 0 },
		{ degree: 7, octave: 0 },
		{ degree: 2, octave: 1 },
		{ degree: 4, octave: 1 },
		{ degree: 6, octave: 1 },
		{ degree: 1, octave: 2 },
		{ degree: 3, octave: 2 },
	],
	8,
);

export const TUNINGS: Record<string, Tuning> = { [C17.id]: C17 };

export function findTine(tuning: Tuning, degree: string, octave: number): Tine | undefined {
	return tuning.tines.find((t) => t.degree === degree && t.octave === octave);
}
