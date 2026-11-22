import { Effect } from "effect";
import { redirect, route } from "spacefn";

// The Archive is now Trash: old links and bookmarks still arrive there.
export default route({ GET: Effect.succeed(redirect("/trash", 301)) });
