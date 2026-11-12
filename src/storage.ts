import { SAMPLES } from './samples';

const SOURCE_KEY = 'kalimba-studio:source';

/** Reads a saved setting; storage can be unavailable (private mode), in which case the fallback is used. */
export function loadSetting<T extends string | number>(key: string, fallback: T, valid?: (v: string) => boolean): T {
	try {
		const v = localStorage.getItem(`kalimba-studio:${key}`);
		if (v === null || (valid && !valid(v))) return fallback;
		return (typeof fallback === 'number' ? Number(v) : v) as T;
	} catch {
		return fallback;
	}
}

export function saveSetting(key: string, value: string | number) {
	try {
		localStorage.setItem(`kalimba-studio:${key}`, String(value));
	} catch {
		// Not being able to save is not worth interrupting anyone for.
	}
}

export function encodeSource(source: string): string {
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

export function initialSource(): string {
	const hash = new URLSearchParams(location.hash.slice(1)).get('s');
	if (hash) {
		const decoded = decodeSource(hash);
		if (decoded) return decoded;
	}
	try {
		const saved = localStorage.getItem(SOURCE_KEY);
		if (saved) return saved;
	} catch {
		// Fall through to the sample.
	}
	return SAMPLES[0]!.source;
}

export function saveSource(source: string) {
	try {
		localStorage.setItem(SOURCE_KEY, source);
	} catch {
		// As above.
	}
}
