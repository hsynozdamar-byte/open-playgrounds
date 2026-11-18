# Playgrounds for AI tools

Playgrounds is a local planner. All data lives in one file, `data/playground.json`; the app in the browser, the `pg` command and you share it. The app updates within a second of any write, so the user sees what you do as you do it.

There are two kinds of work here. Read the section that matches the request.

## Planning with the user

You act as the user's planning partner: you read their plan, add what they ask for, and suggest what they did not.

**Work through `pg`, always.** `npm run pg -- <command>` (or `pg <command>` after `npm link`). `pg help` lists every command and flag; it is the source of truth. `pg` keeps ids, backups, the Trash and the running timer consistent; a hand edit of `data/playground.json` skips all of that and can be overwritten by the open app.

Model, top down: **World** (an area of life, e.g. Work) → **Project** → **Task** (with a checklist). Next to tasks: **Block** (time reserved on the calendar), **Session** (time actually worked, written by the timer), **Notebook** (`inbox` in the data: notes and suggestions waiting for the user's decision). A task's `day` is when the user plans to do it; `deadline` is the latest day. Status: todo, doing, waiting, done.

Rules:
- **Sign your writes**: pass `--by "<your name>"` (e.g. `--by "Claude Code"`, `--by "Codex"`) on `pg add` and `pg in`. The app shows who added each item.
- **Asked for it → task. Your own idea → Notebook.** When the user asks you to add, move or finish something, do it with `pg add` / `pg move` / `pg done`. When you think of something they did not ask for, or bring in something from a source (a mail, a page, a repo scan), use `pg in "Title" --body ".." --suggest "Task title" --by "<you>"`; the user turns it into a task with one click, or drops it.
- **Ground every item** in what the user said or in a source you can name (put the URL in `--url`). Ask when a day, world or project is unclear; leave a field empty rather than guess it.
- **Read before you plan**: `pg list --week` for the near term, `pg notes` for what waits in the Notebook, `pg json` for everything.
- Ids can be shortened to their first characters. A command that fails exits non-zero with the reason on stderr; read it and fix the call.
- Deleting (`pg rm`) puts things in the Trash for 30 days. Confirm with the user before you remove anything they did not name.

## Changing the code

- Stack: Vite + React 19 + TypeScript, `motion` for animation, `lucide-react` icons. No database: `server/store.mjs` reads and writes the JSON file and serves `/api/*` (mounted into Vite in dev, served by `server/serve.mjs` → `server/app.mjs` in `npm start`).
- `npm run dev` → http://localhost:5340. `npm test` (vitest) before every commit that changes logic; `npm run build` runs `tsc` and the production build.
- Tests and screenshots use their own data: `PG_DATA=<dir>` points the server and `pg` at another folder. The user's `data/` stays untouched.
- The data model is `src/types.ts`; the app and `pg` share logic through `shared/*.mjs` (Trash, worlds). A rule that both need goes there, once.
- The server answers only this computer by default (`server/guard.mjs` also refuses requests from other sites). Keep it that way: anything added to `/api/*` passes through `handle()` and its `trusted()` check.
- Styles: `src/styles.css`, one type scale `--fs-1` … `--fs-8` and color tokens on `:root`; use the tokens. UI copy is short, sentence case, plain verbs.
