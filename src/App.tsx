import { useEffect, useMemo, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { play, type PlaybackHandle } from './audio/player';
import { layoutScore, positionAtTick } from './layout/layout';
import { parse } from './model/parse';
import type { Diagnostic } from './model/score';
import { ScoreSvg } from './render/ScoreSvg';
import { SAMPLES } from './samples';

const STORAGE_KEY = 'kalimba-studio:source';

function encodeSource(source: string): string {
	const bytes = new TextEncoder().encode(source);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeSource(encoded: string): string | null {
	try {
		const bin = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
		return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
	} catch {
		return null;
	}
}

function initialSource(): string {
	const hash = new URLSearchParams(location.hash.slice(1)).get('s');
	if (hash) {
		const decoded = decodeSource(hash);
		if (decoded) return decoded;
	}
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved) return saved;
	} catch {
		// Storage can be unavailable (private mode); the sample is a fine fallback.
	}
	return SAMPLES[0]!.source;
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

export function App() {
	const [source, setSource] = useState(initialSource);
	const [showSource, setShowSource] = useState(true);
	const [zoom, setZoom] = useState(72);
	const [tempoOverride, setTempoOverride] = useState<number | null>(null);
	const [tick, setTick] = useState<number | null>(null);
	const [copied, setCopied] = useState(false);
	const playback = useRef<PlaybackHandle | null>(null);
	const textarea = useRef<HTMLTextAreaElement>(null);
	const [scoreRef, scoreWidth] = useElementWidth<HTMLDivElement>();

	const { score, diagnostics } = useMemo(() => parse(source), [source]);
	const layout = useMemo(
		() => layoutScore(score, { width: Math.max(320, scoreWidth), pxPerQuarter: zoom }),
		[score, scoreWidth, zoom],
	);
	const tempo = tempoOverride ?? score.tempo;

	useEffect(() => {
		try {
			localStorage.setItem(STORAGE_KEY, source);
		} catch {
			// Not being able to save is not worth interrupting anyone for.
		}
	}, [source]);

	useEffect(() => () => playback.current?.stop(), []);

	const cursor = useMemo(() => {
		if (tick === null) return undefined;
		const pos = positionAtTick(layout, tick);
		if (!pos) return undefined;
		return { system: layout.systems.indexOf(pos.system), x: pos.x };
	}, [tick, layout]);

	const togglePlay = () => {
		if (playback.current) {
			playback.current.stop();
			playback.current = null;
			return;
		}
		playback.current = play(score, tempo, (t) => {
			setTick(t);
			if (t === null) playback.current = null;
		});
	};

	const jumpTo = (d: Diagnostic) => {
		const el = textarea.current;
		if (!el) return;
		const lines = source.split('\n');
		let offset = 0;
		for (let i = 0; i < d.span.line - 1; i++) offset += lines[i]!.length + 1;
		offset += d.span.column - 1;
		el.focus();
		el.setSelectionRange(offset, offset + d.span.length);
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

	return (
		<div className="app">
			<header className="toolbar">
				<h1>Kalimba Studio</h1>
				<button className="primary" onClick={togglePlay} disabled={score.events.length === 0}>
					{tick === null ? 'Play' : 'Stop'}
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
				<label>
					Spacing
					<input type="range" min={36} max={160} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
				</label>
				<select
					value=""
					onChange={(e) => {
						const sample = SAMPLES.find((s) => s.id === e.target.value);
						if (sample) {
							setSource(sample.source);
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
				<span className="spacer" />
				<button onClick={() => setShowSource((v) => !v)}>{showSource ? 'Hide source' : 'Show source'}</button>
				<button onClick={downloadSvg}>Download SVG</button>
				<button onClick={share}>{copied ? 'Link copied' : 'Copy link'}</button>
			</header>

			<main className={showSource ? 'with-source' : ''}>
				{showSource && (
					<section className="source">
						<textarea
							ref={textarea}
							value={source}
							spellCheck={false}
							onChange={(e) => setSource(e.target.value)}
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
							<summary>Format</summary>
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
							</ul>
						</details>
					</section>
				)}
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
					<div className="scroll">
						<ScoreSvg layout={layout} cursor={cursor} />
					</div>
				</section>
			</main>
		</div>
	);
}
