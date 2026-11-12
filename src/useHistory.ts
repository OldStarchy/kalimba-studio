import { useCallback, useRef, useState } from 'react';

interface Snapshot {
	source: string;
	caret: number;
}

/** How long typing in the text area can pause and still count as one undo step. */
const COALESCE_MS = 800;

/**
 * Source text plus caret with undo/redo. Edits made from the staff or the kalimba are one step each;
 * runs of typing in the text area are grouped.
 */
export function useHistory(initial: string) {
	const [state, setState] = useState<Snapshot>({ source: initial, caret: 0 });
	// Mirrors `state` so history bookkeeping happens outside React's (possibly repeated) updaters.
	const current = useRef(state);
	const past = useRef<Snapshot[]>([]);
	const future = useRef<Snapshot[]>([]);
	const lastTyped = useRef(0);

	const set = useCallback((next: Snapshot) => {
		current.current = next;
		setState(next);
	}, []);

	const commit = useCallback(
		(source: string, caret: number, opts: { typing?: boolean } = {}) => {
			const prev = current.current;
			if (prev.source !== source) {
				const now = Date.now();
				const coalesce = opts.typing && now - lastTyped.current < COALESCE_MS;
				lastTyped.current = opts.typing ? now : 0;
				if (!coalesce) {
					past.current.push(prev);
					if (past.current.length > 200) past.current.shift();
				}
				future.current = [];
			}
			set({ source, caret });
		},
		[set],
	);

	const setCaret = useCallback((caret: number) => set({ ...current.current, caret }), [set]);

	const undo = useCallback(() => {
		const snap = past.current.pop();
		if (!snap) return;
		future.current.push(current.current);
		lastTyped.current = 0;
		set(snap);
	}, [set]);

	const redo = useCallback(() => {
		const snap = future.current.pop();
		if (!snap) return;
		past.current.push(current.current);
		lastTyped.current = 0;
		set(snap);
	}, [set]);

	return {
		source: state.source,
		caret: state.caret,
		commit,
		setCaret,
		undo,
		redo,
		canUndo: past.current.length > 0,
		canRedo: future.current.length > 0,
	};
}
