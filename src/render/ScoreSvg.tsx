import type { ReactNode } from 'react';
import type { Primitive, ScoreLayout } from '../layout/layout';

export interface ScoreSvgProps {
	layout: ScoreLayout;
	/** Playback cursor, if playing. */
	cursor?: { system: number; x: number };
}

/** Rest glyph centred on (x, y). */
function restPath(x: number, y: number, value: number): ReactNode {
	if (value === 1 || value === 2) {
		// Whole rests hang below the short ledger, half rests sit on it.
		const ry = value === 1 ? y : y - 5;
		return (
			<g>
				<line x1={x - 9} x2={x + 9} y1={y} y2={y} className="ink-stroke" strokeWidth={1.2} />
				<rect x={x - 6} y={ry} width={12} height={5} className="ink-fill" />
			</g>
		);
	}
	if (value === 4) {
		return (
			<path
				d={`M${x - 2} ${y - 14} L${x + 4} ${y - 7} L${x - 2} ${y - 1} L${x + 4} ${y + 5} Q${x - 5} ${y + 3} ${x + 1} ${y + 13}`}
				fill="none"
				className="ink-stroke"
				strokeWidth={2}
				strokeLinejoin="round"
				strokeLinecap="round"
			/>
		);
	}
	const hooks = Math.log2(value / 4);
	const topY = y - 10;
	const bottomY = y + 12 + (hooks - 1) * 3;
	const topX = x + 5;
	const bottomX = x - 2 - (hooks - 1) * 2;
	const along = (yy: number) => topX + ((yy - topY) / (bottomY - topY)) * (bottomX - topX);
	const parts: ReactNode[] = [
		<line key="d" x1={topX} y1={topY} x2={bottomX} y2={bottomY} className="ink-stroke" strokeWidth={1.5} strokeLinecap="round" />,
	];
	for (let k = 0; k < hooks; k++) {
		const hy = topY + k * 7;
		const hx = along(hy);
		parts.push(
			<g key={k}>
				<circle cx={hx - 6} cy={hy + 1.5} r={2.6} className="ink-fill" />
				<path d={`M${hx - 6} ${hy + 1.5} Q${hx - 2} ${hy + 3} ${hx} ${hy}`} fill="none" className="ink-stroke" strokeWidth={1.3} />
			</g>,
		);
	}
	return <g>{parts}</g>;
}

function flagPath(x: number, y: number): string {
	return `M${x} ${y} C${x + 2} ${y + 5} ${x + 10} ${y + 7} ${x + 8} ${y + 15} C${x + 7} ${y + 10} ${x + 3} ${y + 8} ${x} ${y + 7} Z`;
}

function renderPrimitive(p: Primitive, key: number): ReactNode {
	switch (p.type) {
		case 'staffLine':
			return <line key={key} x1={p.x1} x2={p.x2} y1={p.y} y2={p.y} className="staff" />;
		case 'barline':
			return p.final ? (
				<g key={key}>
					<line x1={p.x - 5} x2={p.x - 5} y1={p.y1} y2={p.y2} className="staff" />
					<line x1={p.x - 1.5} x2={p.x - 1.5} y1={p.y1} y2={p.y2} className="staff" strokeWidth={3} />
				</g>
			) : (
				<line key={key} x1={p.x} x2={p.x} y1={p.y1} y2={p.y2} className="staff" />
			);
		case 'grid':
			return <line key={key} x1={p.x} x2={p.x} y1={p.y1} y2={p.y2} className="grid" />;
		case 'barNumber':
			return (
				<text key={key} x={p.x} y={p.y} className="bar-number">
					{p.text}
				</text>
			);
		case 'glyph':
			return (
				<g key={key} className={`glyph side-${p.side}${p.hollow ? ' hollow' : ''}`}>
					<path d={p.fill} className="glyph-fill" fill={p.hollow ? 'none' : `url(#fade-${p.side})`} />
					<path d={p.outline} className="glyph-outline" fill="none" />
				</g>
			);
		case 'label': {
			const dots: ReactNode[] = [];
			const n = Math.abs(p.octave);
			for (let i = 0; i < n; i++) {
				// Dots sit just clear of the digit's cap height, stacking away from it.
				const clear = p.size * 0.42 + 3 + i * 4;
				dots.push(<circle key={i} cx={p.x} cy={p.y + (p.octave > 0 ? -clear : clear)} r={p.size > 14 ? 1.8 : 1.5} />);
			}
			return (
				<g key={key} className={`label side-${p.side} ${p.placement}${p.hollow ? ' hollow' : ''}`}>
					<text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fontSize={p.size}>
						{p.degree}
					</text>
					{dots}
				</g>
			);
		}
		case 'stem':
			return <line key={key} x1={p.x} x2={p.x} y1={p.y1} y2={p.y2} className="stem" />;
		case 'beam':
			return <rect key={key} x={p.x1 - 0.7} y={p.y - p.thickness / 2} width={p.x2 - p.x1 + 1.4} height={p.thickness} className="ink-fill" />;
		case 'flag':
			return <path key={key} d={flagPath(p.x, p.y)} className="ink-fill" />;
		case 'rest':
			return <g key={key}>{restPath(p.x, p.y, p.value)}</g>;
		case 'dot':
			return <circle key={key} cx={p.x} cy={p.y} r={1.8} className="ink-fill" />;
	}
}

/**
 * Styles live inside the SVG so an exported file looks the same as the page.
 * Concrete colours rather than CSS variables keep it renderable by standalone SVG tools.
 */
const SVG_STYLE = `
.staff { stroke: #888780; stroke-width: 1; }
.grid { stroke: #B4B2A9; stroke-width: 0.75; stroke-dasharray: 3 4; }
.bar-number { fill: #888780; font: 11px system-ui, sans-serif; }
.ink-fill { fill: #2C2C2A; }
.ink-stroke { stroke: #2C2C2A; }
.stem { stroke: #2C2C2A; stroke-width: 1.4; }
.cursor { stroke: #7F77DD; stroke-width: 2; }
.glyph-outline { stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.side-L .glyph-outline { stroke: #D85A30; }
.side-R .glyph-outline { stroke: #378ADD; }
.fade-L-stop { stop-color: #F0997B; }
.fade-R-stop { stop-color: #85B7EB; }
.label text { font-family: system-ui, sans-serif; font-weight: 500; }
.label.below text { font-weight: 600; }
.label.side-L text, .label.side-L circle { fill: #4A1B0C; }
.label.side-R text, .label.side-R circle { fill: #042C53; }
.label.hollow.side-L text, .label.hollow.side-L circle,
.label.below.side-L text, .label.below.side-L circle { fill: #993C1D; }
.label.hollow.side-R text, .label.hollow.side-R circle,
.label.below.side-R text, .label.below.side-R circle { fill: #185FA5; }
@media (prefers-color-scheme: dark) {
	.ink-fill { fill: #E8E6DF; }
	.ink-stroke, .stem { stroke: #E8E6DF; }
	.grid { stroke: #5F5E5A; }
	.fade-L-stop { stop-color: #D85A30; }
	.fade-R-stop { stop-color: #378ADD; }
	.label.side-L text, .label.side-L circle, .label.side-R text, .label.side-R circle { fill: #FFFFFF; }
	.label.hollow.side-L text, .label.hollow.side-L circle,
	.label.below.side-L text, .label.below.side-L circle { fill: #F0997B; }
	.label.hollow.side-R text, .label.hollow.side-R circle,
	.label.below.side-R text, .label.below.side-R circle { fill: #85B7EB; }
}
`;

export function ScoreSvg({ layout, cursor }: ScoreSvgProps) {
	return (
		<svg
			className="score"
			width={layout.width}
			height={layout.height}
			viewBox={`0 0 ${layout.width} ${layout.height}`}
			role="img"
			aria-label="Kalimba score"
		>
			<style>{SVG_STYLE}</style>
			<defs>
				<linearGradient id="fade-L" x1="0" y1="1" x2="0" y2="0">
					<stop offset="0" className="fade-L-stop" stopOpacity={0.95} />
					<stop offset="1" className="fade-L-stop" stopOpacity={0.08} />
				</linearGradient>
				<linearGradient id="fade-R" x1="0" y1="1" x2="0" y2="0">
					<stop offset="0" className="fade-R-stop" stopOpacity={0.95} />
					<stop offset="1" className="fade-R-stop" stopOpacity={0.08} />
				</linearGradient>
			</defs>
			{layout.systems.map((s, i) => (
				<g key={i}>
					{s.primitives.map(renderPrimitive)}
					{cursor?.system === i && <line x1={cursor.x} x2={cursor.x} y1={s.top - 4} y2={s.top + s.height + 4} className="cursor" />}
				</g>
			))}
		</svg>
	);
}
