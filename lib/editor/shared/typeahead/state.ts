import { createStore, type Store } from "../../core/store.ts";
import { matchId, type TriggerMatch } from "./logic.ts";

export interface TypeaheadState<T> {
	/** The trigger being typed; null while the menu is closed. */
	match: TriggerMatch | null;
	items: T[];
	active: number;
	/** The match Escape closed, so it stays closed while typing on. */
	dismissed: string | null;
}

export type TypeaheadStore<T> = Store<TypeaheadState<T>> & {
	/** Shows `items` for `match`; the highlight goes back to the top when the query changes. */
	show(match: TriggerMatch, items: T[]): void;
	close(): void;
	/** Closes and keeps this match closed. */
	dismiss(): void;
	/** Moves the highlight by `delta`, wrapping around. */
	move(delta: number): void;
	highlight(index: number): void;
	/** Whether Escape closed the menu for this match. */
	isDismissed(match: TriggerMatch): boolean;
};

export function createTypeaheadStore<T>(): TypeaheadStore<T> {
	const store = createStore<TypeaheadState<T>>({
		match: null,
		items: [],
		active: 0,
		dismissed: null,
	});
	return Object.assign(store, {
		show(match: TriggerMatch, items: T[]) {
			const { match: previous, active } = store.get();
			const from = previous?.query === match.query ? active : 0;
			store.set({ match, items, active: Math.min(from, items.length - 1), dismissed: null });
		},
		close() {
			store.set({ match: null });
		},
		dismiss() {
			const { match } = store.get();
			store.set({ match: null, dismissed: match ? matchId(match) : null });
		},
		move(delta: number) {
			const { items, active } = store.get();
			if (items.length > 0) store.set({ active: (active + delta + items.length) % items.length });
		},
		highlight(index: number) {
			store.set({ active: index });
		},
		isDismissed(match: TriggerMatch) {
			return store.get().dismissed === matchId(match);
		},
	});
}
