import { Effect } from "effect";
import { route } from "spacefn";

// Not public: 204 while the session holds, the middleware's 401 after.
export default route({ GET: Effect.void });
