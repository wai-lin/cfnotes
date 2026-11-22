/** Commands extensions use to talk to each other without importing each other. */
import { createCommand, type NodeKey } from "lexical";

/**
 * Drop blocks beside a block as a new column (Notion's drag-to-side).
 * Dispatched inside `editor.update`; handled by the columns extension, which
 * returns false when it can't (the caller then drops them as usual).
 */
export const DROP_BESIDE_COMMAND = createCommand<{
	target: NodeKey;
	keys: NodeKey[];
	side: "left" | "right";
}>("DROP_BESIDE_COMMAND");
