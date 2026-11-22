/**
 * The new order after putting `id` just before `beforeId` (`null` = at the end).
 * `siblings` are the ids in current order; `id` may or may not be among them.
 * Returns `null` when `beforeId` isn't one of the siblings.
 */
export function placeBefore(
	siblings: readonly string[],
	id: string,
	beforeId: string | null,
): string[] | null {
	const rest = siblings.filter((sibling) => sibling !== id);
	if (beforeId === null) return [...rest, id];
	if (beforeId === id) return null;
	const at = rest.indexOf(beforeId);
	if (at < 0) return null;
	return [...rest.slice(0, at), id, ...rest.slice(at)];
}
