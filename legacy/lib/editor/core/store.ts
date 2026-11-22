/**
 * A tiny observable state container. Each feature keeps its UI state (what's
 * open, what's highlighted, what the pointer is over) in one of these: the
 * logic changes it with `set`, and the view redraws from it in `subscribe`.
 */
export interface Store<S extends object> {
	get(): S;
	/** Merges `patch` in and notifies listeners, unless nothing changed. */
	set(patch: Partial<S>): void;
	/** Calls `listener` after every change; returns the unsubscribe function. */
	subscribe(listener: (state: S, prev: S) => void): () => void;
}

export function createStore<S extends object>(initial: S): Store<S> {
	let state = initial;
	const listeners = new Set<(state: S, prev: S) => void>();
	return {
		get: () => state,
		set(patch) {
			const keys = Object.keys(patch) as (keyof S)[];
			if (keys.every((key) => Object.is(state[key], patch[key]))) return;
			const prev = state;
			state = { ...state, ...patch };
			for (const listener of listeners) listener(state, prev);
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
