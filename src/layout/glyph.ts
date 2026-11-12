/**
 * Geometry for the tine glyphs that hang off an event's stem.
 *
 * Coordinates are y-down. `stemX` is the centre line; `dir` is -1 for left-thumb glyphs (hanging left of the stem)
 * and +1 for right-thumb glyphs. A glyph is open at the top, filled with a fade, and its stem-side edge above
 * the attachment point is drawn by the stem itself, so the outline path stops there.
 */

export interface GlyphColumn {
	/** y of the tine tip (the glyph's lowest point in that column). */
	bottom: number;
	/** True for the centre tine: drawn with a square bottom, or a point when paired. */
	root: boolean;
}

export interface GlyphGeometry {
	/** Closed path for the fill. */
	fill: string;
	/** Open outline: outer edge, bottom, and back up to the stem attachment point. */
	outline: string;
	/** Where the stem should end: the top of the curve on the stem side. */
	attachY: number;
	top: number;
	/** Bottom y at the centre of each column, inner first, for placing labels. */
	columnBottoms: number[];
}

export interface GlyphMetrics {
	width: number;
	height: number;
	radius: number;
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();
const pt = (x: number, y: number) => `${f(x)} ${f(y)}`;

/**
 * Distance from a corner to the tangent points of a fillet of radius r,
 * given the interior angle between the two edges.
 */
export function filletTangentDistance(radius: number, interiorAngle: number): number {
	return radius / Math.tan(interiorAngle / 2);
}

/**
 * Builds a single- or double-column glyph. `columns` are ordered inner (next to the stem) to outer.
 */
export function buildGlyph(stemX: number, dir: -1 | 1, columns: GlyphColumn[], m: GlyphMetrics): GlyphGeometry {
	if (columns.length === 1) return single(stemX, dir, columns[0]!, m);
	return double(stemX, dir, columns[0]!, columns[1]!, m);
}

function single(stemX: number, dir: -1 | 1, col: GlyphColumn, m: GlyphMetrics): GlyphGeometry {
	const inner = stemX;
	const outer = stemX + dir * m.width;
	const b = col.bottom;
	const top = b - m.height;
	// Going from the inner edge round the bottom to the outer edge: clockwise on screen for left glyphs.
	const sweep = dir > 0 ? 0 : 1;
	const back = 1 - sweep;

	if (col.root) {
		return {
			fill: `M${pt(inner, top)} L${pt(inner, b)} L${pt(outer, b)} L${pt(outer, top)} Z`,
			outline: `M${pt(outer, top)} L${pt(outer, b)} L${pt(inner, b)}`,
			attachY: b,
			top,
			columnBottoms: [b],
		};
	}

	const r = Math.min(m.radius, m.width / 2);
	const arcY = b - r;
	const arc = (s: number, x: number) =>
		`A${f(r)} ${f(r)} 0 0 ${s} ${pt(x, arcY)}`;
	return {
		fill: `M${pt(inner, top)} L${pt(inner, arcY)} ${arc(sweep, inner + dir * 2 * r)} L${pt(outer, arcY)} L${pt(outer, top)} Z`,
		outline: `M${pt(outer, top)} L${pt(outer, arcY)} ${arc(back, inner)}`,
		attachY: arcY,
		top,
		columnBottoms: [b],
	};
}

function double(stemX: number, dir: -1 | 1, innerCol: GlyphColumn, outerCol: GlyphColumn, m: GlyphMetrics): GlyphGeometry {
	const xi = stemX;
	const xo = stemX + dir * 2 * m.width;
	const bi = innerCol.bottom;
	const bo = outerCol.bottom;
	const top = Math.min(bi, bo) - m.height;
	const sweep = dir > 0 ? 0 : 1;
	const back = 1 - sweep;
	const r = m.radius;

	// Unit vector along the bottom edge, inner corner -> outer corner.
	const dx = xo - xi;
	const dy = bo - bi;
	const len = Math.hypot(dx, dy);
	const ux = dx / len;
	const uy = dy / len;

	// Interior angle at each bottom corner between the vertical side and the diagonal bottom.
	// Inner corner: edges go up (0,-1) and along u. Outer corner: edges go along -u and up.
	const innerAngle = Math.acos(Math.max(-1, Math.min(1, -uy)));
	const outerAngle = Math.PI - innerAngle;

	// Keep fillets from overrunning the bottom edge or the glyph's sides.
	const limit = (d: number, side: number) => Math.min(d, len / 2, side);
	const dInner = innerCol.root ? 0 : limit(filletTangentDistance(r, innerAngle), bi - top);
	const dOuter = outerCol.root ? 0 : limit(filletTangentDistance(r, outerAngle), bo - top);

	const p1 = { x: xi, y: bi - dInner };
	const p2 = { x: xi + ux * dInner, y: bi + uy * dInner };
	const q1 = { x: xo - ux * dOuter, y: bo - uy * dOuter };
	const q2 = { x: xo, y: bo - dOuter };

	// The fillet radius actually achieved, which differs from r only when a limit kicked in.
	const rInner = dInner * Math.tan(innerAngle / 2);
	const rOuter = dOuter * Math.tan(outerAngle / 2);

	const innerCornerFwd = dInner > 0 ? `L${pt(p1.x, p1.y)} A${f(rInner)} ${f(rInner)} 0 0 ${sweep} ${pt(p2.x, p2.y)}` : `L${pt(xi, bi)}`;
	const outerCornerFwd = dOuter > 0 ? `L${pt(q1.x, q1.y)} A${f(rOuter)} ${f(rOuter)} 0 0 ${sweep} ${pt(q2.x, q2.y)}` : `L${pt(xo, bo)}`;
	const outerCornerBack = dOuter > 0 ? `L${pt(q2.x, q2.y)} A${f(rOuter)} ${f(rOuter)} 0 0 ${back} ${pt(q1.x, q1.y)}` : `L${pt(xo, bo)}`;
	const innerCornerBack = dInner > 0 ? `L${pt(p2.x, p2.y)} A${f(rInner)} ${f(rInner)} 0 0 ${back} ${pt(p1.x, p1.y)}` : `L${pt(xi, bi)}`;

	const at = (x: number) => bi + ((x - xi) / dx) * dy;
	return {
		fill: `M${pt(xi, top)} ${innerCornerFwd} ${outerCornerFwd} L${pt(xo, top)} Z`,
		outline: `M${pt(xo, top)} ${outerCornerBack} ${innerCornerBack}`,
		attachY: p1.y,
		top,
		columnBottoms: [at(xi + dir * m.width * 0.5), at(xi + dir * m.width * 1.5)],
	};
}
