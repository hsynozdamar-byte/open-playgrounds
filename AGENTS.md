# Playgrounds for AI tools

Playgrounds is a local planner. All data lives in one file, `playground.json` (in `data/` in a checkout; the desktop app's folder is in README.md); the app, the `pg` command and you share it. The app updates within a second of any write, so the user sees what you do as you do it.

There are three kinds of work here. Read the section that matches the request.

## Planning with the user

You act as the user's planning partner: you read their plan, add what they ask for, and suggest what they did not.

**Work through `pg`, always.** `npm run pg -- <command>` (or `pg <command>` after `npm link`). `pg help` lists every command and flag; it is the source of truth. `pg` keeps ids, backups, the Trash and the running timer consistent; a hand edit of `playground.json` skips all of that and can be overwritten by the open app.

Model, top down: **World** (an area of life, e.g. Work) → **Project** → **Task** (with a checklist). Next to tasks: **Block** (time reserved on the calendar), **Session** (time actually worked, written by the timer), **Notebook** (`inbox` in the data: notes and suggestions waiting for the user's decision), **Automation** (opens a task on set days and times). A task's `day` is when the user plans to do it; `deadline` is the latest day. Status: todo, doing, waiting, done.

Rules:
- **Sign your writes**: pass `--by "<your name>"` (e.g. `--by "Claude Code"`, `--by "Codex"`) on `pg add` and `pg in`. The app shows who added each item.
- **Asked for it → task. Your own idea → Notebook.** When the user asks you to add, move or finish something, do it with `pg add` / `pg move` / `pg done`. When you think of something they did not ask for, or bring in something from a source (a mail, a page, a repo scan), use `pg in "Title" --body ".." --suggest "Task title" --by "<you>"`; the user turns it into a task with one click, or drops it.
- **Anything to be shared from an account is a post task**: `pg add "Title" --post <accountId|@handle|platform> --by "<you>"`, so it shows on the Posts page with its approval and sharing steps.
- **Ground every item** in what the user said or in a source you can name (put the URL in `--url`). Ask when a day, world or project is unclear; leave a field empty rather than guess it.
- **Read before you plan**: `pg list --week` for the near term, `pg notes` for what waits in the Notebook, `pg json` for everything.
- Ids can be shortened to their first characters. A command that fails exits non-zero with the reason on stderr; read it and fix the call.
- Deleting (`pg rm`) puts things in the Trash for 30 days. Confirm with the user before you remove anything they did not name.

## Doing a task

Playgrounds itself runs nothing for you: a task is a note of intent until someone does it. When the user asks you to do a task ("do my Instagram task", "handle today's list"), you do it with your own tools.

1. **Read the task**: `pg list` (or `pg json`) for its title, notes, checklist, world and project. Done when you know what finished looks like.
2. **Ask one question when the title is ambiguous** ("Instagram" could mean post, check messages or update the bio). Done when you know which.
3. **Do it with your tools.** Examples: "open my Instagram" → open https://instagram.com in the user's browser, or `pg pb <world> https://instagram.com` to bring that world's signed-in session forward in the desktop app; a writing task → write the text and attach it with `pg run <taskId> "Title" --body ".."`. Stop and ask before any outward step: signing up, posting, sending, paying, deleting. Done when every part the user can check is in front of them.
4. **Close it**: `pg done <id>` once the user's goal is met (for an outward step, after the user confirmed it happened). Done when the task shows as done in the app.

### The desktop app's browser

The desktop app keeps one signed-in browser session per world. Use it when a task needs the user's accounts.

- **Control API** on `http://127.0.0.1:9334`, every request with the header `x-pg: 1`:
  - `GET /state`: worlds with their logins and tabs (each tab has a CDP `targetId`).
  - `POST /open {"worldId", "url", "newTab": true}`: opens a tab in that world's session and brings it forward; the reply has the tab and its `targetId`.
  - `POST /focus {"tabId"}`: brings a tab forward. `GET /shot?tab=<tabId>`: a screenshot.
- **Chrome DevTools Protocol** on `127.0.0.1:9333`, for reading and clicking in a page. With [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp):

  ```json
  {
    "mcpServers": {
      "playgrounds-browser": {
        "command": "npx",
        "args": ["-y", "chrome-devtools-mcp@1.12.0", "--browserUrl", "http://127.0.0.1:9333"]
      }
    }
  }
  ```

  Open tabs through `POST /open` (a CDP `new_page` lands outside the world's session), then select that page by its `targetId` and work only in it. When 9333 or 9334 is taken at launch, the app picks free ports; `pg pb` still works because the server learns them.

## Changing the code

- Stack: Vite + React 19 + TypeScript, `motion` for animation, `lucide-react` icons. No database: `server/store.mjs` reads and writes the JSON file and serves `/api/*` (mounted into Vite in dev, served by `server/serve.mjs` → `server/app.mjs` in `npm start`). Rou's jobs run the user's LLM CLI through `server/claude.mjs` and `shared/llm.mjs`.
- `npm run dev` → http://localhost:5340. `npm test` (vitest) before every commit that changes logic; `npm run build` runs `tsc` and the production build.
- Tests and screenshots use their own data: `PG_DATA=<dir>` points the server and `pg` at another folder. The user's data stays untouched.
- The data model is `src/types.ts`; the app and `pg` share logic through `shared/*.mjs`. A rule that both need goes there, once.
- The server answers only this computer by default (`server/guard.mjs` also refuses requests from other sites). Keep it that way: anything added to `/api/*` passes through `handle()` and its `trusted()` check.
- Styles: `src/styles.css`, one type scale `--fs-1` … `--fs-8` and color tokens on `:root`; use the tokens. UI copy is English, short, sentence case, plain verbs.
