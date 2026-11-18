# Playgrounds

A local-first planner you share with your AI tools.

Worlds, projects, tasks, a calendar, a focus timer and a notebook, all in one JSON file on your computer. The app shows it; the `pg` command and any AI coding tool (Claude Code, Codex, Cursor, Gemini CLI, …) can read and write it. When a tool adds a task, it appears in the open app within a second, signed with the tool's name.

![Focus page](docs/focus.png)

## Run it

You need Node.js 20.11 or newer.

```bash
git clone https://github.com/hsynozdamar-byte/open-playgrounds.git
```

```bash
cd open-playgrounds && npm install
```

```bash
npm run dev
```

Open http://localhost:5340. Start with the example world or create your own.

`npm start` builds the app and serves it with a small Node server on the same port (no dev tooling). Both listen on 127.0.0.1 only.

## What is in it

- **Worlds**: the areas of your life (Work, Home, a side project). Each has its own color and lens; the logo shows them all.
- **Projects and tasks**: tasks have a day, an optional deadline, an estimate and a checklist. Projects collect tasks and **sources** (notes, text files and links you want an AI tool to know about).
- **Focus**: today's list, late work, upcoming deadlines and an hour timeline. A free timer or pomodoro writes the time you actually worked.
- **Calendar**: drag tasks into hours, see the week, read the week review.
- **Notebook**: quick notes, ideas and suggestions from your tools. One click turns an item into a task.
- **Trash and backups**: deletes stay in the Trash for 30 days; the data file is backed up once a day in `data/backups/`.

Quick add understands plain text: `Call the bank tomorrow 14:00 30m @home #paperwork`.

## Use it with your AI tools

Open the folder in your tool and ask, for example:

> Read AGENTS.md, then run `npm run pg -- list` and tell me what is on my plate today.

![A suggestion from Claude Code in the Notebook](docs/notebook.png)

`AGENTS.md` tells the tool how to work here: through `pg`, signing what it writes, putting its own ideas in the Notebook instead of your task list. `CLAUDE.md` points Claude Code to the same file.

Some things to ask:

- "Plan my week from these notes" (paste them).
- "Break the website project into tasks with estimates."
- "Look at this repo's open issues and suggest tasks for the Work world."
- "Block two hours tomorrow morning for the report."

## The `pg` command

```bash
npm run pg -- help
```

Or install it on your PATH:

```bash
npm link
```

```bash
pg add "Write the about page" --pg work --project Website --day yarın --at 10:00 --min 45 --by "Claude Code"
pg in "Read the new API docs" --pg work --url https://example.com/docs --suggest "Read API docs" --by "Codex"
pg list --week
pg notes
```

Days: `bugün`, `yarın`, `tarihsiz`, `pzt`…`paz`, or `YYYY-MM-DD`.

## Data

Everything is in `data/playground.json` (created on first run, ignored by git). The app watches the file, so a write from `pg`, a script or a tool shows up at once; a save from the app never overwrites a newer write from elsewhere.

Set `PG_DATA=/some/folder` to point the app and `pg` at another data folder, for example to try things out:

```bash
PG_DATA=/tmp/pg-try npm run dev
```

There is no login. The server answers only this computer and refuses requests from other websites. To open it from your phone over Tailscale, start it with `PG_LISTEN=0.0.0.0 PG_ALLOW_TAILSCALE=1 npm start`; anyone on that network can then read and change your data.

## The in-app assistant (Rou)

Rou, the assistant inside the app, runs your own LLM command line tool with your own subscription; no API key is stored. Pick it in **Profile › Settings › Asistan**: Claude Code (`claude`, the default), Codex (`codex exec`) or Gemini CLI (`gemini`). The status light says when the chosen command is not on your PATH or not signed in.

Only Claude Code can use tools, so reading images and files, web search, work in Chrome or in the app's browser, live steps and Rou's code changes need it. With another CLI those jobs stop with a message that says so; chat, drafts, topic planning and post writing work.

Environment variables override the setting:

| Variable | Meaning |
|---|---|
| `PG_LLM_CMD` | the command, e.g. `codex`, `npx @anthropic-ai/claude-code`, `ollama run llama3` |
| `PG_LLM_KIND` | `claude`, `codex`, `gemini` or `text` (any command that reads a prompt on stdin and prints text); guessed from the command |
| `PG_LLM_ARGS` | extra flags for every call, as a JSON array |
| `PG_LLM_PROMPT` | `stdin` (default) or `arg` |
| `PG_MODEL`, `PG_MODEL_MID`, `PG_MODEL_FAST` | models for the strong, middle and fast tier (Claude: `opus`, `sonnet`, `haiku`) |

Everything Rou answers from (your tasks, notes, sources) is sent to the provider of the command you chose.

## Desktop app

The desktop app (Electron) shows Playgrounds in its own window, starts its own server on Electron's built-in Node (no separate Node install needed to run it), and adds a per-world browser page where Rou can work in your logged-in tabs.

Build an installer on your own machine:

```bash
npm run dist:mac   # dist-electron/Playgrounds-<version>-<arch>.dmg
npm run dist:win   # dist-electron/Playgrounds-Setup-<version>.exe (NSIS, Desktop and Start Menu shortcut)
```

- **macOS**: open the dmg and drag Playgrounds to Applications. Without a signing identity the app is ad-hoc signed, so the first launch needs right-click › Open (or `xattr -dr com.apple.quarantine /Applications/Playgrounds.app`). Set `CSC_NAME` (or `CSC_LINK`) to sign with your own Developer ID.
- **Windows**: run the setup exe; it installs per user and adds the shortcuts. The installer is unsigned, so SmartScreen asks once. The Windows installer can be built on a Mac.
- Data lives in the per-user app folder: `~/Library/Application Support/Playgrounds/data` on macOS, `%APPDATA%\Playgrounds\data` on Windows (`PG_DATA` overrides it). The log is `~/Library/Logs/Playgrounds/Playgrounds.log` or `%APPDATA%\Playgrounds\logs`.
- The app uses port 5340 when it is free. If another server already runs there it uses it only when it is the same install (or the same data folder); otherwise it picks a free port and remembers it.
- Start at login stays off until you turn it on in the app menu.
- What the app runs still has to be on your PATH: your LLM CLI, `ffmpeg`/`ffprobe` for media, optionally `whisper-cli` for voice. `PG_FFMPEG`, `PG_FFPROBE`, `PG_WHISPER`, `PG_WHISPER_MODEL` and `PG_CHROME` (headless shell) take full paths instead.
- On Windows a few macOS-only extras are hidden or skipped: bringing Google Chrome to the front, the AppleScript notification fallback (the app shows its own notifications). Handed-off share folders go to the Recycle Bin. Video and image rendering (`render/`) needs `npm install` in a checkout and is not part of the installer.

From a checkout, `npm run desktop` opens the same app on the repo (it builds `dist/` when the sources are newer and uses `data/`). `browser/build.sh` (macOS) installs a bundle that runs the checkout directly, for working on the app itself.

## Develop

```bash
npm test
```

```bash
npm run build
```

Code map: `src/` is the React app (`views/` pages, `ui/` components, `types.ts` the data model), `server/` the file store and API, `shared/` logic used by both the app and `pg`, `scripts/pg.mjs` the CLI, `tests/` vitest.

## License

MIT
