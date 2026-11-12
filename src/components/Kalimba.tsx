import { useEffect, useMemo, useRef, useState } from 'react';
import type { Side, Tine, Tuning } from '../model/tuning';

export interface KalimbaProps {
	tuning: Tuning;
	height: number;
	/** Called for every pluck, including slides from one tine to the next. */
	onPluck: (tine: Tine, side: Side) => void;
}

interface Zone {
	tine: Tine;
	side: Side;
	x: number;
	width: number;
}

const PAD = 8;
const GAP = 3;
const BRIDGE_Y = 10;
/** The centre tine is drawn wider so each half (left thumb / right thumb) is a comfortable target. */
const CENTRE_WEIGHT = 1.7;

/**
 * An on-screen kalimba. Tines hang from the bridge at their real relative lengths, so the picture
 * matches the glyphs on the staff. Tap or drag across tines; the centre tine's left and right halves
 * pick which thumb plays it.
 */
export function Kalimba({ tuning, height, onPluck }: KalimbaProps) {
	const ref = useRef<SVGSVGElement>(null);
	const [width, setWidth] = useState(600);
	const [lit, setLit] = useState<Set<string>>(new Set());
	const lastZone = useRef(new Map<number, string>());

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const { zones, tines } = useMemo(() => {
		const weights = tuning.tines.map((t) => (t.side === 'C' ? CENTRE_WEIGHT : 1));
		const total = weights.reduce((a, b) => a + b, 0);
		const unit = (width - 2 * PAD - GAP * (tuning.tines.length - 1)) / total;
		const maxLen = Math.max(...tuning.tines.map((t) => t.length));
		const usable = height - BRIDGE_Y - 4;
		let x = PAD;
		const zones: Zone[] = [];
		const tines = tuning.tines.map((t, i) => {
			const w = weights[i]! * unit;
			const geom = { tine: t, x, width: w, bottom: BRIDGE_Y + usable * (t.length / maxLen) };
			if (t.side === 'C') {
				zones.push({ tine: t, side: 'L', x, width: w / 2 }, { tine: t, side: 'R', x: x + w / 2, width: w / 2 });
			} else zones.push({ tine: t, side: t.side, x: x - GAP / 2, width: w + GAP });
			x += w + GAP;
			return geom;
		});
		return { zones, tines };
	}, [tuning, width, height]);

	const zoneAt = (clientX: number): Zone | undefined => {
		const rect = ref.current!.getBoundingClientRect();
		const x = clientX - rect.left;
		return zones.find((z) => x >= z.x && x < z.x + z.width);
	};

	const key = (z: Zone) => `${z.tine.index}${z.side}`;

	const fire = (z: Zone) => {
		onPluck(z.tine, z.side);
		const k = key(z);
		setLit((prev) => new Set(prev).add(k));
		setTimeout(
			() =>
				setLit((prev) => {
					const next = new Set(prev);
					next.delete(k);
					return next;
				}),
			160,
		);
	};

	return (
		<svg
			ref={ref}
			className="kalimba"
			width="100%"
			height={height}
			role="group"
			aria-label="Virtual kalimba"
			onPointerDown={(e) => {
				e.preventDefault();
				const z = zoneAt(e.clientX);
				if (!z) return;
				(e.currentTarget as Element).setPointerCapture(e.pointerId);
				lastZone.current.set(e.pointerId, key(z));
				fire(z);
			}}
			onPointerMove={(e) => {
				const last = lastZone.current.get(e.pointerId);
				if (last === undefined) return;
				const z = zoneAt(e.clientX);
				if (!z || key(z) === last) return;
				lastZone.current.set(e.pointerId, key(z));
				fire(z);
			}}
			onPointerUp={(e) => lastZone.current.delete(e.pointerId)}
			onPointerCancel={(e) => lastZone.current.delete(e.pointerId)}
		>
			<rect x={PAD - 2} y={BRIDGE_Y - 6} width={Math.max(0, width - 2 * PAD + 4)} height={6} rx={3} className="kalimba-bridge" />
			{tines.map(({ tine, x, width: w, bottom }) => {
				const r = Math.min(w / 2, 8);
				const label = (cx: number, side: Side) => (
					<g className={`kalimba-label side-${side}`}>
						<text x={cx} y={bottom - 9} textAnchor="middle" dominantBaseline="central">
							{tine.degree}
						</text>
						{Array.from({ length: Math.abs(tine.octave) }, (_, i) => (
							<circle key={i} cx={cx} cy={tine.octave > 0 ? bottom - 18 - i * 4 : bottom - 3 + i * 4} r={1.5} />
						))}
					</g>
				);
				if (tine.side === 'C') {
					const half = w / 2;
					return (
						<g key={tine.index}>
							<path
								d={`M${x} ${BRIDGE_Y} V${bottom} H${x + half} V${BRIDGE_Y} Z`}
								className={`kalimba-tine side-L${lit.has(`${tine.index}L`) ? ' lit' : ''}`}
							/>
							<path
								d={`M${x + half} ${BRIDGE_Y} V${bottom} H${x + w} V${BRIDGE_Y} Z`}
								className={`kalimba-tine side-R${lit.has(`${tine.index}R`) ? ' lit' : ''}`}
							/>
							{label(x + half / 2, 'L')}
							{label(x + half * 1.5, 'R')}
						</g>
					);
				}
				const side = tine.side;
				return (
					<g key={tine.index}>
						<path
							d={`M${x} ${BRIDGE_Y} V${bottom - r} A${r} ${r} 0 0 0 ${x + w} ${bottom - r} V${BRIDGE_Y} Z`}
							className={`kalimba-tine side-${side}${lit.has(`${tine.index}${side}`) ? ' lit' : ''}`}
						/>
						{label(x + w / 2, side)}
					</g>
				);
			})}
		</svg>
	);
}
