# Kalimba Studio

A viewer for kalimba music in a notation designed for the instrument rather than borrowed from piano tabs.

## The notation

- Each key is drawn as a **U-shaped tine** with its number at the bottom, filled in its thumb's colour and fading upwards.
- Every onset has a **centre stem**. Left-thumb keys hang to the left of it (coral), right-thumb keys to the right (blue), so the hand is readable from shape alone.
- The **vertical position** of a tine's tip matches its real length on the instrument, which for a standard layout works out as a compressed pitch staff.
- Two keys under **one thumb** become one wide glyph with a diagonal bottom, inner (lower) key next to the stem.
- The **centre tine** has a square bottom, or a point when it's part of a one-thumb pair, because it's the key that could be played by either thumb.
- **Time runs left to right to scale.** Notes keep a minimum gap, and any stretch that causes is carried forward; dashed gridlines on beats (or half bars or bars, depending on density) keep the beat readable.
- Rhythm uses ordinary **flags, beams, dots and rests**. Half and whole notes are hollow; whole notes keep only the short divider between glyphs.

## Text format

```
title: Ode to Joy
tempo: 100
time: 4/4
tuning: c17

1L+3/4 3 4 5 | 3+5/4 4 3 2 | 1R+3/4 1L 2 3 | 3/4. 2/8 2/2 |
```

| Token | Meaning |
| --- | --- |
| `3/8` | key 3 for an eighth note |
| `4` | key 4 with the previous duration |
| `1L+3/4` | keys together; the centre tine needs `L` or `R`, other keys take their side from the tuning |
| `3L` | override the side for a cross-thumb reach |
| `1'` `2,` | octave up / down |
| `/4.` | dotted |
| `r/8` | rest |
| `\|` | bar check (warns if it doesn't land on a bar line) |
| `# ...` | comment |

`1L+3` is a split chord (one key per thumb); `1R+3` is a right-thumb double.

## Playing and editing

- **Virtual kalimba** along the bottom: tap or slide across tines (multi-touch works). The centre tine is split: its left half is the left thumb, its right half the right thumb.
- **Caret** on the staff, like a text cursor: click to place it, ←/→/Home/End to move it, Space to play from it.
- **Insert mode** (kalimba panel): taps insert at the caret with the selected duration; taps within ~70 ms become one chord. On the staff, <kbd>1</kbd>–<kbd>7</kbd> insert keys (Shift for the octave up), <kbd>r</kbd> a rest, <kbd>.</kbd> toggles dotted, Backspace/Delete remove.
- **Record**: one bar of count-in (plus however far into its bar the caret sits, so timing lines up), then play freely. Stopping snaps taps to the chosen grid, groups simultaneous taps into chords (max two per thumb), and inserts the result at the caret.
- **Click**: a metronome that runs on its own, or alongside playback.
- **Undo/redo** covers every edit, including typing in the source.

Edits are made on the source text, so everything stays visible and editable there. Inserting or deleting pins the following token's duration when it was inherited, so nothing else in the piece changes length.

Playback is a two-partial synth (fundamental plus the bar's second bending mode at ~6.27×), panned by each tine's position on the instrument.

## Development

```sh
npm install
npm run dev
npm test
npx tsx scripts/render.tsx scratch   # render the samples to SVG/PNG for checking layout changes
```

Code layout:

- `src/model` — tunings, score types, the text parser, and source edits (insert/delete at a caret, record quantisation)
- `src/layout` — pure layout: spacing with the minimum gap, line breaking, beams, gridlines, glyph geometry (including fillets on slanted doubles)
- `src/render` — React SVG renderer; styles are embedded so a downloaded SVG looks the same
- `src/audio` — shared Web Audio engine, playback, metronome
- `src/components` — the virtual kalimba

Pushing to `main` deploys to GitHub Pages via Actions.
