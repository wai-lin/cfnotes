# Notes for coding agents

cfnotes is a spacefn app, on Effect 4. spacefn's docs (`content/`) and example apps (`examples/`) for the installed version are in `node_modules/spacefn-docs/`: read them before guessing an API.

- `app/` only wires the runtime: its files connect code from `modules/` and `lib/` to routes, pages, jobs and the entry, with no logic or markup of their own.
- A feature's logic, views, client code and tests go in `modules/<feature>/`. Code shared by features (UI kit, design tokens, helpers) goes in `lib/`, which doesn't import `modules/`.
- `.space/` is generated: never edit it. After adding, removing or renaming a file in `app/`, run `pnpm exec space gen` (`pnpm dev` does it on its own).
- `configs/env.ts` is imported by deploys, so it may import only `spacefn` and `effect`.
- Check your work with `pnpm run check` (format, lint and types) and `pnpm test`; `pnpm run fmt` formats; `pnpm exec space doctor` explains setup problems.
- Commit messages: conventional commits, one line, no body.

## Traps

- spacefn checks every row against the query's generated types at runtime, and infers a scalar subquery as non-null. Give one that can be null a `-- @column name type?` line, and test it with a null.
- An action that returns data or html renders its whole page again. For `fetch` callers return a response: `json` or `fragment` from `lib/responses.ts`.
- Action bodies default to 1 MiB; a bigger one needs `limits` on the action.
- `<notes-editor>` is a light-DOM Rocket element with no `render`: Lexical owns its children. Keep `ignoredByMorph: "children"` and `data-ignore`.
- Rocket's `emit(name, detail)` takes a string `detail` for another event's name. Dispatch a `CustomEvent` for those.
- Every request needs a session, through `app/routes/_middleware.ts`: a new route is private. Only a path in `modules/auth/guard.ts`'s list is public. Never send `cache-control: public` for what's private.
- spacefn 0.11.1's `variables()` can't see `.env` files: Alchemy loads them into Config, not `process.env`. `configs/infra.ts` passes it what Config has, so keep that second argument.
- In tests, `cfnotes()` from `lib/testing.ts` is signed in; use its `anonymous` for signed-out requests.
- Browser behavior (saving, Rocket, Datastar) isn't covered by `pnpm test`: try it in a browser.
