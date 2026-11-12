export interface Sample {
	id: string;
	name: string;
	source: string;
}

export const SAMPLES: Sample[] = [
	{
		id: 'ode-to-joy',
		name: 'Ode to Joy',
		source: `title: Ode to Joy
composer: Beethoven
tempo: 100
time: 4/4
tuning: c17

# Melody with a few chords. 1 is the centre tine, so it always says which thumb plays it.
1L+3/4 3 4 5 | 3+5/4 4 3 2 | 1R+3/4 1L 2 3 | 3/4. 2/8 2/2 |
1L+3/4 3 4 5 | 3+5/4 4 3 2 | 1R+3/4 1L 2 3 | 2/4. 1L/8 1L+3/2 |
`,
	},
	{
		id: 'notation-tour',
		name: 'Notation tour',
		source: `title: Notation tour
tempo: 80
time: 4/4

# Split chord, right-thumb double with the root, beamed eighths and sixteenths, a rest, an upper-octave chord
1L+3/4 1R+3/8 5 4/16 6 r/8 1'+2'/4 |

# Doubles away from the root, dotted rhythm, and a half note (hollow)
3+5/8. 2/16 4+6/8 2/8 1L+3/2 |

# Thirty-seconds alternating thumbs: the minimum gap stretches the beat
3/32 2 5 4 3 2 5 4 r/4 1R/2 |

# Whole note
1L+3/1 |
`,
	},
];
