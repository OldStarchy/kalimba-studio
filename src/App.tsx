import { type KeyboardEvent, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { audio, PAN_WIDTH, pluck } from './audio/engine';
import { Metronome } from './audio/metronome';
import { play, type PlaybackHandle } from './audio/player';
import { Kalimba } from './components/Kalimba';
import { caretAtPoint, caretPosition, layoutScore, positionAtTick } from './layout/layout';
import { caretTick, deleteEvent, type Duration, insertTokens, quantiseTaps, type Tap, tokenText } from './model/edit';
import { parse } from './model/parse';
import { barTicks, type Diagnostic, type Note, PPQ } from './model/score';
import { findTine, type Side, type Tine } from './model/tuning';
import { ScoreSvg } from './render/ScoreSvg';
import { SAMPLES } from './samples';
import { encodeSource, initialSource, loadSetting, saveSetting, saveSource } from './storage';
import { useHistory } from './useHistory';

type LabelPlacement = 'inside' | 'below';
type TapMode = 'play' | 'insert';

const DURATIONS: { value: number; label: string; title: string }[] = [
	{ value: 1, label: '1', title: 'Whole' },
	{ value: 2, label: '½', title: 'Half' },
	{ value: 4, label: '¼', title: 'Quarter' },
	{ value: 8, label: '⅛', title: 'Eighth' },
	{ value: 16, label: '1/16', title: 'Sixteenth' },
	{ value: 32, label: '1/32', title: 'Thirty-second' },
];

/** Taps on the kalimba this close together become one chord when inserting. */
const CHORD_WINDOW_MS = 70;

interface Recording {
	/** Audio-clock time of the caret's position; taps are measured from here. */
	zero: number;
	countInBeats: number;
	taps: Tap[];
}

function useElementWidth<T extends HTMLElement>() {
	const ref = useRef<T>(null);
	const [width, setWidth] = useState(800);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	return [ref, width] as const;
}

function useViewportHeight() {
	const [h, setH] = useState(() => window.innerHeight);
	useEffect(() => {
		const on = () => setH(window.innerHeight);
		window.addEventListener('resize', on);
		return () => window.removeEventListener('resize', on);
	}, []);
	return h;
}

export function App() {
	const { source, caret, commit, setCaret, undo, redo, canUndo, canRedo } = useHistory(initialSource());
	const [showSource, setShowSource] = useState(() => loadSetting('showSource', 'yes') === 'yes');
	const [showKalimba, setShowKalimba] = useState(() => loadSetting('showKalimba', 'yes') === 'yes');
	const [zoom, setZoom] = useState<number>(() => loadSetting('zoom', 72));
	const [labels, setLabels] = useState<LabelPlacement>(() => loadSetting('labels', 'inside', (v) => v === 'inside' || v === 'below'));
	const [spread, setSpread] = useState<number>(() => loadSetting('spread', 20));
	const [tapMode, setTapMode] = useState<TapMode>(() => loadSetting('tapMode', 'play', (v) => v === 'play' || v === 'insert'));
	const [duration, setDuration] = useState<Duration>({ value: 4, dots: 0 });
	const [recordGrid, setRecordGrid] = useState<number>(() => loadSetting('recordGrid', 16));
	const [metronomeOn, setMetronomeOn] = useState(false);
	const [tempoOverride, setTempoOverride] = useState<number | null>(null);
	const [tick, setTick] = useState<number | null>(null);
	const [recording, setRecording] = useState<Recording | null>(null);
	const [beat, setBeat] = useState<number | null>(null);
	const [copied, setCopied] = useState(false);

	const playback = useRef<PlaybackHandle | null>(null);
	const metronome = useRef(new Metronome());
	const recordingRef = useRef<Recording | null>(null);
	const pendingChord = useRef<{ notes: Note[]; timer: ReturnType<typeof setTimeout> } | null>(null);
	const textarea = useRef<HTMLTextAreaElement>(null);
	const staffRef = useRef<HTMLDivElement>(null);
	const [scoreRef, scoreWidth] = useElementWidth<HTMLDivElement>();
	const viewportHeight = useViewportHeight();

	const { score, diagnostics } = useMemo(() => parse(source), [source]);
	const layout = useMemo(
		() => layoutScore(score, { width: Math.max(320, scoreWidth), pxPerQuarter: zoom, labels, tipSpread: spread }),
		[score, scoreWidth, zoom, labels, spread],
	);
	const tempo = tempoOverride ?? score.tempo;
	const safeCaret = Math.min(caret, score.events.length);

	// Latest values for callbacks that outlive a render (chord timers, metronome beats).
	const live = useRef({ source, score, caret: safeCaret, duration });
	live.current = { source, score, caret: safeCaret, duration };

	useEffect(() => saveSource(source), [source]);
	useEffect(() => saveSetting('labels', labels), [labels]);
	useEffect(() => saveSetting('zoom', zoom), [zoom]);
	useEffect(() => saveSetting('spread', spread), [spread]);
	useEffect(() => saveSetting('tapMode', tapMode), [tapMode]);
	useEffect(() => saveSetting('recordGrid', recordGrid), [recordGrid]);
	useEffect(() => saveSetting('showSource', showSource ? 'yes' : 'no'), [showSource]);
	useEffect(() => saveSetting('showKalimba', showKalimba ? 'yes' : 'no'), [showKalimba]);

	useEffect(() => {
		const m = metronome.current;
		return () => {
			playback.current?.stop();
			m.stop();
		};
	}, []);

	const cursor = useMemo(() => {
		if (tick === null) return undefined;
		const pos = positionAtTick(layout, tick);
		if (!pos) return undefined;
		return { system: layout.systems.indexOf(pos.system), x: pos.x };
	}, [tick, layout]);

	const caretPos = useMemo(() => caretPosition(layout, safeCaret), [layout, safeCaret]);

	// Keep the caret in view while editing.
	useEffect(() => {
		if (!caretPos) return;
		const system = layout.systems[caretPos.system];
		const svg = staffRef.current?.querySelector('svg');
		if (!system || !svg) return;
		const rect = svg.getBoundingClientRect();
		const y = rect.top + system.top + system.height / 2;
		if (y < 100 || y > window.innerHeight - 220) window.scrollBy({ top: y - window.innerHeight / 3, behavior: 'smooth' });
	}, [caretPos, layout]);

	// ---- Transport ----

	const stopPlayback = () => {
		playback.current?.stop();
		playback.current = null;
	};

	const togglePlay = () => {
		if (recordingRef.current) return;
		if (playback.current) return stopPlayback();
		metronome.current.stop();
		const fromCaret = safeCaret < score.events.length ? caretTick(score, safeCaret) : 0;
		playback.current = play(score, { tempo, startTick: fromCaret, metronome: metronomeOn }, (t) => {
			setTick(t);
			if (t === null) {
				playback.current = null;
				if (metronomeOn && !recordingRef.current) startFreeMetronome();
			}
		});
	};

	const beatSeconds = (60 / tempo) * (4 / score.time.unit);

	const startFreeMetronome = () => {
		const { ctx } = audio();
		metronome.current.start({ startTime: ctx.currentTime + 0.05, beatSeconds, beatsPerBar: score.time.beats, onBeat: setBeat });
	};

	const toggleMetronome = () => {
		const next = !metronomeOn;
		setMetronomeOn(next);
		if (playback.current || recordingRef.current) return; // takes effect next time
		if (next) startFreeMetronome();
		else {
			metronome.current.stop();
			setBeat(null);
		}
	};

	// Restart a free-running metronome when the tempo or metre changes.
	useEffect(() => {
		if (metronomeOn && !playback.current && !recordingRef.current) startFreeMetronome();
	}, [tempo, score.time.beats, score.time.unit]);

	const startRecording = () => {
		stopPlayback();
		flushChord();
		const { ctx } = audio();
		const secondsPerTick = 60 / tempo / PPQ;
		const bar = barTicks(score.time);
		const posInBar = caretTick(score, safeCaret) % bar;
		// One full bar of count-in, plus however far into its bar the caret sits, so recorded time lines up.
		const lead = (bar + posInBar) * secondsPerTick;
		const zero = ctx.currentTime + 0.15 + lead;
		const rec: Recording = { zero, countInBeats: Math.round((bar + posInBar) / ((PPQ * 4) / score.time.unit)), taps: [] };
		recordingRef.current = rec;
		setRecording(rec);
		metronome.current.start({ startTime: zero - lead, beatSeconds, beatsPerBar: score.time.beats, onBeat: setBeat });
	};

	const stopRecording = () => {
		const rec = recordingRef.current;
		if (!rec) return;
		recordingRef.current = null;
		setRecording(null);
		setBeat(null);
		metronome.current.stop();
		if (metronomeOn) startFreeMetronome();
		const { ctx } = audio();
		const tokens = quantiseTaps(rec.taps, {
			tempo,
			grid: (PPQ * 4) / recordGrid,
			stopTime: ctx.currentTime - rec.zero,
			beat: (PPQ * 4) / score.time.unit,
		});
		if (!tokens.length) return;
		const { source: s, score: sc, caret: c } = live.current;
		const out = insertTokens(s, sc, c, tokens);
		commit(out.source, out.caret);
	};

	// ---- Editing ----

	const insert = useCallback(
		(tokens: string[]) => {
			const { source: s, score: sc, caret: c } = live.current;
			const out = insertTokens(s, sc, c, tokens);
			commit(out.source, out.caret);
		},
		[commit],
	);

	function flushChord() {
		const pending = pendingChord.current;
		if (!pending) return;
		clearTimeout(pending.timer);
		pendingChord.current = null;
		insert([tokenText(pending.notes, live.current.duration)]);
	}

	const onPluck = (tine: Tine, side: Side) => {
		pluck(tine.midi, tine.position * PAN_WIDTH);
		const rec = recordingRef.current;
		if (rec) {
			rec.taps.push({ time: audio().ctx.currentTime - rec.zero, tine, side });
			return;
		}
		if (tapMode !== 'insert') return;
		const pending = pendingChord.current ?? { notes: [], timer: setTimeout(flushChord, CHORD_WINDOW_MS) };
		pendingChord.current = pending;
		if (!pending.notes.some((n) => n.tine === tine) && pending.notes.filter((n) => n.side === side).length < 2) {
			pending.notes.push({ tine, side });
		}
	};

	const insertRest = () => insert([tokenText(null, duration)]);

	const deleteBefore = () => {
		if (safeCaret === 0) return;
		const out = deleteEvent(source, score, safeCaret - 1);
		commit(out.source, out.caret);
	};

	const deleteAfter = () => {
		if (safeCaret >= score.events.length) return;
		const out = deleteEvent(source, score, safeCaret);
		commit(out.source, out.caret);
	};

	const onStaffKey = (e: KeyboardEvent<HTMLDivElement>) => {
		const mod = e.ctrlKey || e.metaKey;
		if (mod && e.key.toLowerCase() === 'z') {
			e.preventDefault();
			if (e.shiftKey) redo();
			else undo();
			return;
		}
		if (mod && e.key.toLowerCase() === 'y') {
			e.preventDefault();
			redo();
			return;
		}
		if (mod || e.altKey) return;
		const n = score.events.length;
		let handled = true;
		switch (e.key) {
			case 'ArrowLeft':
				setCaret(Math.max(0, safeCaret - 1));
				break;
			case 'ArrowRight':
				setCaret(Math.min(n, safeCaret + 1));
				break;
			case 'Home':
				setCaret(0);
				break;
			case 'End':
				setCaret(n);
				break;
			case 'Backspace':
				deleteBefore();
				break;
			case 'Delete':
				deleteAfter();
				break;
			case ' ':
				togglePlay();
				break;
			case 'r':
				insertRest();
				break;
			case '.':
				setDuration((d) => ({ ...d, dots: d.dots ? 0 : 1 }));
				break;
			default: {
				// Digits type keys in the middle octave; Shift moves up one. The centre tine goes to the left thumb.
				const digit = /^Digit([1-7])$/.exec(e.code)?.[1];
				const tine = digit ? findTine(score.tuning, digit, e.shiftKey ? 1 : 0) : undefined;
				if (tine) {
					pluck(tine.midi, tine.position * PAN_WIDTH);
					insert([tokenText([{ tine, side: tine.side === 'C' ? 'L' : tine.side }], duration)]);
				} else handled = false;
			}
		}
		if (handled) e.preventDefault();
	};

	const onStaffPointer = (e: PointerEvent<HTMLDivElement>) => {
		const svg = staffRef.current?.querySelector('svg');
		if (!svg) return;
		const rect = svg.getBoundingClientRect();
		const x = ((e.clientX - rect.left) / rect.width) * layout.width;
		const y = ((e.clientY - rect.top) / rect.height) * layout.height;
		setCaret(caretAtPoint(layout, x, y));
	};

	// ---- Misc ----

	const jumpTo = (d: Diagnostic) => {
		const el = textarea.current;
		if (!el) return;
		el.focus();
		el.setSelectionRange(d.span.offset, d.span.offset + d.span.length);
	};

	const downloadSvg = () => {
		const svg = renderToStaticMarkup(<ScoreSvg layout={layout} />).replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
		const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = `${(score.title ?? 'kalimba').replace(/[^\w-]+/g, '-').toLowerCase()}.svg`;
		a.click();
		URL.revokeObjectURL(url);
	};

	const share = async () => {
		const url = `${location.origin}${location.pathname}#s=${encodeSource(source)}`;
		history.replaceState(null, '', url);
		try {
			await navigator.clipboard.writeText(url);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// The address bar now has the link even if the clipboard is blocked.
		}
	};

	const errors = diagnostics.filter((d) => d.severity === 'error').length;
	const kalimbaHeight = Math.round(Math.max(90, Math.min(170, viewportHeight * 0.26)));

	let recordStatus = '';
	if (recording) {
		if (beat === null || beat < recording.countInBeats) {
			recordStatus = `Count-in ${recording.countInBeats - (beat ?? 0)}`;
		} else {
			const b = beat - recording.countInBeats;
			recordStatus = `Recording · beat ${b + 1}`;
		}
	}

	return (
		<div className="app">
			<header className="toolbar">
				<h1>Kalimba Studio</h1>
				<button className="primary" onClick={togglePlay} disabled={score.events.length === 0 || !!recording} title="Play from the caret (Space)">
					{tick === null ? 'Play' : 'Stop'}
				</button>
				<button
					className={`record${recording ? ' active' : ''}`}
					onClick={recording ? stopRecording : startRecording}
					title="Record from the caret, with a bar of count-in"
				>
					{recording ? 'Stop rec' : 'Record'}
				</button>
				<button className={`toggle${metronomeOn ? ' on' : ''}`} onClick={toggleMetronome} aria-pressed={metronomeOn} title="Metronome">
					<span className={`beat-dot${beat !== null && beat % score.time.beats === 0 ? ' accent' : ''}${beat !== null ? ' pulse' : ''}`} key={beat ?? -1} />
					Click
				</button>
				<label>
					Tempo
					<input
						type="number"
						min={20}
						max={300}
						value={tempo}
						onChange={(e) => {
							const n = Number(e.target.value);
							setTempoOverride(Number.isFinite(n) && n > 0 ? n : null);
						}}
					/>
				</label>
				{recording && <span className="rec-status">{recordStatus}</span>}
				<span className="spacer" />
				<button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z on the staff)">
					Undo
				</button>
				<button onClick={redo} disabled={!canRedo} title="Redo">
					Redo
				</button>
				<details className="menu">
					<summary>View</summary>
					<div className="menu-panel">
						<label>
							Spacing
							<input type="range" min={36} max={160} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
						</label>
						<label title="How far apart the tine tips sit vertically">
							Height
							<input type="range" min={8} max={120} value={spread} onChange={(e) => setSpread(Number(e.target.value))} />
						</label>
						<label>
							Numbers
							<select value={labels} onChange={(e) => setLabels(e.target.value as LabelPlacement)}>
								<option value="inside">Inside tine</option>
								<option value="below">Below tine (larger)</option>
							</select>
						</label>
						<label className="check">
							<input type="checkbox" checked={showKalimba} onChange={(e) => setShowKalimba(e.target.checked)} />
							Kalimba
						</label>
						<label className="check">
							<input type="checkbox" checked={showSource} onChange={(e) => setShowSource(e.target.checked)} />
							Source text
						</label>
						<select
							value=""
							onChange={(e) => {
								const sample = SAMPLES.find((s) => s.id === e.target.value);
								if (sample) {
									commit(sample.source, 0);
									setTempoOverride(null);
								}
							}}
						>
							<option value="" disabled>
								Load sample…
							</option>
							{SAMPLES.map((s) => (
								<option key={s.id} value={s.id}>
									{s.name}
								</option>
							))}
						</select>
						<button onClick={downloadSvg}>Download SVG</button>
						<button onClick={share}>{copied ? 'Link copied' : 'Copy link'}</button>
					</div>
				</details>
			</header>

			<main>
				<section className="sheet" ref={scoreRef}>
					{(score.title || score.composer) && (
						<div className="titles">
							{score.title && <h2>{score.title}</h2>}
							{score.composer && <p>{score.composer}</p>}
						</div>
					)}
					{errors > 0 && (
						<p className="error-note">
							{errors} {errors === 1 ? 'problem' : 'problems'} in the source; those notes are left out.
						</p>
					)}
					<div
						className="scroll staff-focus"
						ref={staffRef}
						tabIndex={0}
						onKeyDown={onStaffKey}
						onPointerDown={onStaffPointer}
						aria-label="Score. Arrow keys move the caret, digits insert keys, Backspace deletes."
					>
						<ScoreSvg layout={layout} cursor={cursor} caret={caretPos} />
					</div>
				</section>

				{showSource && (
					<section className="source">
						<textarea
							ref={textarea}
							value={source}
							spellCheck={false}
							onChange={(e) => commit(e.target.value, caret, { typing: true })}
							aria-label="Score source"
						/>
						<div className="diagnostics">
							{diagnostics.length === 0 ? (
								<p className="ok">No problems</p>
							) : (
								<ul>
									{diagnostics.map((d, i) => (
										<li key={i} className={d.severity}>
											<button onClick={() => jumpTo(d)}>
												<span className="where">
													{d.span.line}:{d.span.column}
												</span>
												{d.message}
											</button>
										</li>
									))}
								</ul>
							)}
						</div>
						<details className="help">
							<summary>Format and shortcuts</summary>
							<ul>
								<li>
									<code>3/8</code> key 3 for an eighth note. Leave off the <code>/8</code> to repeat the last duration.
								</li>
								<li>
									<code>1L+3/4</code> simultaneous keys. The centre tine always needs <code>L</code> or <code>R</code>.
								</li>
								<li>
									<code>1'</code> up an octave, <code>2,</code> down one. <code>/4.</code> is dotted.
								</li>
								<li>
									<code>r/8</code> rest. <code>|</code> checks the bar adds up. <code>#</code> starts a comment.
								</li>
								<li>
									Headers: <code>title:</code> <code>composer:</code> <code>tempo:</code> <code>time: 3/4</code>{' '}
									<code>tuning: c17</code>
								</li>
								<li>
									On the staff: click to place the caret, ←/→ to move it, <kbd>1</kbd>–<kbd>7</kbd> insert a key (Shift for the
									octave up), <kbd>r</kbd> rest, <kbd>.</kbd> toggles dotted, Backspace/Delete remove, Space plays from the caret.
								</li>
							</ul>
						</details>
					</section>
				)}
			</main>

			{showKalimba && (
				<footer className="kalimba-panel">
					<div className="kalimba-controls">
						<div className="segmented" role="group" aria-label="What tapping does">
							<button className={tapMode === 'play' ? 'on' : ''} onClick={() => setTapMode('play')}>
								Play
							</button>
							<button className={tapMode === 'insert' ? 'on' : ''} onClick={() => setTapMode('insert')}>
								Insert
							</button>
						</div>
						<div className="segmented" role="group" aria-label="Duration to insert">
							{DURATIONS.map((d) => (
								<button
									key={d.value}
									className={duration.value === d.value ? 'on' : ''}
									title={d.title}
									onClick={() => setDuration((cur) => ({ ...cur, value: d.value }))}
								>
									{d.label}
								</button>
							))}
							<button
								className={duration.dots ? 'on' : ''}
								title="Dotted"
								onClick={() => setDuration((cur) => ({ ...cur, dots: cur.dots ? 0 : 1 }))}
							>
								·
							</button>
						</div>
						<button onClick={insertRest} title="Insert a rest at the caret">
							Rest
						</button>
						<button onClick={deleteBefore} disabled={safeCaret === 0} title="Delete before the caret">
							⌫
						</button>
						<label title="Recording snaps to this grid">
							Grid
							<select value={recordGrid} onChange={(e) => setRecordGrid(Number(e.target.value))}>
								<option value={8}>⅛</option>
								<option value={16}>1/16</option>
								<option value={32}>1/32</option>
							</select>
						</label>
					</div>
					<Kalimba tuning={score.tuning} height={kalimbaHeight} onPluck={onPluck} />
				</footer>
			)}
		</div>
	);
}
