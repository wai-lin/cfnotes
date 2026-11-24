# cfnotes

A Notion-like notes app on [spacefn](https://github.com/space-fn/spacefn) (Effect and Alchemy) for Cloudflare Workers: pages, a block editor, inline databases with scripts and formulas, search and Trash.

Sign-in is with Google, for the emails you list. They all share one workspace.

## Sign in with Google

1. In [Google Cloud](https://console.cloud.google.com/auth/clients), open Google Auth Platform (set up the app's branding if it asks) and create a client of type **Web application**.
2. Add the authorized redirect URI `http://localhost:1337/auth/google`, and `https://<your domain>/auth/google` for a deploy.
3. Copy `.env.example` to `.env`, fill it in and restart `pnpm dev`:

| Variable               | What it is                                                   |
| ---------------------- | ------------------------------------------------------------ |
| `ORIGIN`               | Where the app is reached, with no trailing slash             |
| `GOOGLE_CLIENT_ID`     | The client's ID                                              |
| `GOOGLE_CLIENT_SECRET` | The client's secret                                          |
| `ALLOWED_EMAILS`       | Who may sign in, comma-separated. They can all edit anything |

A deploy needs the same four in `.env.prod`, with its https `ORIGIN`, so know the app's address before the first one.

- `ALLOWED_EMAILS` is the only thing limiting who gets in. Google's test-user list doesn't: apps that ask only for name and email admit any Google account.
- For an address that's neither Gmail nor Google Workspace, Google verifies the email once, when the account is made. Take it off the list if it changes hands.
- If port 1337 is busy, `space dev` takes the next one and sign-in fails. Free the port, or change `ORIGIN` and the redirect URI to match.
- A session lasts 30 days, or 7 without use. Taking an email off the list ends its sessions once the app restarts or deploys.

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
├── crons/              the daily purges of Trash and old sessions
└── assets/             the browser's two entries: main.ts and site.css
modules/
├── auth/               Google sign-in, sessions and the guard on every request
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
```
