# cfnotes

A Notion-like notes app on [spacefn](https://github.com/space-fn/spacefn) (Effect and Alchemy) for Cloudflare Workers: pages, a block editor, inline databases with scripts and formulas, search and Trash.

> [!WARNING]
> There is no sign-in. Anyone who can reach a deployed copy can read, change and delete every note.

## Commands

| Command                  | What it does                                       |
| ------------------------ | -------------------------------------------------- |
| `pnpm dev`               | Runs the app locally, reloading on every change    |
| `pnpm test`              | Runs the tests                                     |
| `pnpm check`             | Checks formatting (oxfmt), lint (oxlint) and types |
| `pnpm fmt`               | Formats the code with oxfmt                        |
| `pnpm run deploy`        | Deploys to your Cloudflare account, stage `prod`   |
| `pnpm run docs`          | Shows `docs/` and spacefn's docs in the browser    |
| `pnpm exec space doctor` | Checks what dev and deploy need                    |

Local settings go in `.env` (copy `.env.example`). A deploy reads `.env.<stage>`, e.g. `.env.prod`, or the environment.

## Where things go

`app/` holds what spacefn reads, and each file there only connects code from `modules/` and `lib/`.

```txt
app/
├── entry.ts            the app: its services and what wraps every request
├── routes/             pages and endpoints
├── db/main/            the D1 database: migrations and queries in SQL
├── crons/              the daily Trash purge
└── assets/             the browser's two entries: main.ts and site.css
modules/
├── pages/              a page: saving, views, and the <notes-editor> Rocket element
├── database/           databases: changes, the table UI, and script/ (QuickJS sandbox)
├── sidebar/            folders and pages in the tree
├── trash/              remove, restore, purge, Undo
├── search/             quick-find
├── files/              uploads, in Blob (R2)
├── unfurl/             bookmark previews
└── workspace/          the shell around every page
lib/
├── editor/             the block editor; knows nothing about cfnotes
├── datastar/           Datastar with Rocket, vendored and pinned
└── ui/                 dialogs, toasts, the app's styles
configs/                env, infra (Alchemy), Vite, Vitest, TypeScript, oxlint, oxfmt
legacy/                 the spacefn 0.10 app, for reference until it's deleted
```
