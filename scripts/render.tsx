/**
 * Renders the bundled samples to SVG and PNG for eyeballing layout changes.
 * Usage: npx tsx scripts/render.tsx [outDir]
 */
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { layoutScore } from '../src/layout/layout';
import { parse } from '../src/model/parse';
import { ScoreSvg } from '../src/render/ScoreSvg';
import { SAMPLES } from '../src/samples';

const outDir = process.argv[2] ?? 'scratch';
mkdirSync(outDir, { recursive: true });

for (const sample of SAMPLES) {
	const { score, diagnostics } = parse(sample.source);
	for (const d of diagnostics) console.warn(`${sample.id}:${d.span.line}:${d.span.column} ${d.severity}: ${d.message}`);
	for (const labels of ['inside', 'below'] as const) {
		const name = labels === 'inside' ? sample.id : `${sample.id}-${labels}`;
		const layout = layoutScore(score, { width: 760, labels });
		const svg = renderToStaticMarkup(<ScoreSvg layout={layout} />).replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
		writeFileSync(join(outDir, `${name}.svg`), svg);
		const png = new Resvg(svg, { background: '#ffffff', fitTo: { mode: 'zoom', value: 2 } }).render().asPng();
		writeFileSync(join(outDir, `${name}.png`), png);
		console.log(`wrote ${name}`);
	}
}
