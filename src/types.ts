// Vocabulary and rules: docs/PLAN.md §1

// accounts: the world's accounts (posting accounts and incoming sources). Projects pick from them.
// identity: the brand's identity (name spelling, color, font, logo files, intro text); kit: font, color, logo used when generating visuals (render/src/Footage.tsx Kit).
export type World = { id: string; name: string; color: string; color2?: string; description: string; accounts?: Account[]; identity?: string; kit?: Record<string, unknown>; visual?: string };

export type ProjectStatus = "active" | "paused" | "done";
// ongoing: an ongoing project (no deadline); its rhythm is the project's automations. accountIds: which of the world's accounts this project uses. brand: brand frame to follow when preparing posts.
export type Project = { id: string; worldId: string; name: string; description: string; status: ProjectStatus; deadline: string | null; ongoing?: boolean; accountIds?: string[]; sources?: Source[]; brand?: Brand;
  mediaDir?: string; mediaDirs?: string[]; media?: Record<string, "good" | "bad"> }; // mediaDir: media folder on disk; media: file (path relative to the folder) → Good/Bad
export type Brand = { audience: string; pillars: string[]; use: string; avoid: string; example?: string }; // example: the target text the user approved (shared/social.mjs brandExample)

// A project source: a note, an uploaded text file or a link. The content is stored in the data (not tied to a path on disk).
// use: whether it is given to Claude when preparing. A link's content is not fetched; its address and note are given.
export type SourceKind = "note" | "file" | "link";
export type Source = { id: string; kind: SourceKind; title: string; body: string; url?: string; use: boolean; addedAt: string };

// Live status while Rou works in Chrome (server/live.mjs): which Chrome, last page, current step, last steps.
export type Live = { browser: string; url: string; step: string; at: string; log: string[]; waiting?: boolean }; // waiting: Claude in Chrome is waiting for permission/approval
// The account's language: a single language, or first Turkish with English below it (shared/social.mjs LANGS).
export type Lang = "tr" | "en" | "tr+en";
// Account: a world's posting place or incoming source (shared/social.mjs). voice: short style note.
// browser: the Chrome that will do the sharing (Claude in Chrome device id); check: the last check of the account signed in on that Chrome.
export type Platform = "instagram" | "linkedin" | "x" | "threads" | "tiktok" | "youtube" | "other";
export type Feed = "gmail" | "gcal" | "slack" | "clickup";
// login: sign-in email or username (display only; the password is not stored).
// Result of an account analysis (server/insight.mjs): with Instagram skills.
export type Insight = { at: string; phase?: string; error?: string; score?: number | null; summary?: string; items?: { title: string; detail: string }[] };
export type Account = { insights?: Partial<Record<"profile" | "audit" | "plan", Insight>>; id: string; platform: Platform | Feed; name: string; handle: string; voice: string; lang?: Lang; login?: string; premium?: boolean; browser?: { id: string; name: string }; check?: { at: string; ok: boolean; seen?: string; error?: string }; pbLogin?: { at: string; phase?: string; ok?: boolean; seen?: string; error?: string } };
export type PostFormat = "ig_post" | "ig_reel" | "linkedin" | "tweet" | "thread" | "threads" | "short" | "text";
export type Post =
  | { format: "ig_post"; slides: { title: string; text: string }[]; caption: string; hashtags: string[] }
  | { format: "ig_reel" | "short"; hook: string; scenes: { text: string; sec: number; accent?: string }[]; caption: string; hashtags: string[] }
  | { format: "linkedin" | "text"; text: string }
  | { format: "tweet" | "thread" | "threads"; tweets: string[]; quote?: XTarget; reply?: XTarget };
// Tweet quoted or replied to on X (server/xquote.mjs).
export type XTarget = { url: string; name?: string; handle?: string; avatar?: string; text?: string; media?: { kind: "image" | "video"; thumb: string; video?: string }; inner?: { name?: string; handle?: string; text?: string; media?: { kind: "image" | "video"; thumb: string; video?: string } } };

export type TaskStatus = "todo" | "doing" | "waiting" | "done";
export type CheckItem = { id: string; text: string; done: boolean };
export type Task = {
  id: string;
  worldId: string;
  projectId: string | null;
  title: string;
  notes: string;
  status: TaskStatus;
  day: string | null; // when I will do it (YYYY-MM-DD), no time
  deadline: string | null; // at the latest
  estimate: number | null; // minutes
  checklist: CheckItem[];
  source?: { type: string; url: string; ref?: string };
  by: string;
  createdAt: string;
  doneAt?: string;
  order?: number; // manual ordering in the Today list
  autoId?: string; // the automation's task for that day
  format?: PostFormat; // the format of this task in an automation with sequential formats (shared/repeat.mjs formatAt)
  who?: "me" | "claude"; // who does the task (task without automation); you if unset
  browser?: { id: string; name: string }; // Rou does it: the Chrome the task is done in (server/browse.mjs doTask)
  sharer?: "claude" | "me"; // who shares this post (overrides the automation's)
  revise?: { note: string; prev: string; at: string; pending?: boolean }; // revision note for the next preparation
  revisions?: { at: string; note: string; runId?: string; prev: string; clear?: { ask: string; keep: string[]; ban: string[]; media: "keep" | "new" | "none" | "any"; text: boolean; visual: boolean; general?: string; rule?: { text: string; autos: string[]; kind: "visual" | "text"; art?: true } }; saved?: string[] }[]; // all revision notes, oldest to newest (shared/revise.mjs); never deleted
  autoSlot?: string; // which time of the automation ("08:00"; "" if it has no time)
  autoDay?: string; // which day's task of the automation this is (does not change even if the task is moved to another day)
  post?: PlannedPost; // a planned social post (Posts › Plan the week); without automation
  queuedAt?: string; // waiting in Rou's preparation queue (server/prepare.mjs prepareMany)
  topic?: Topic; // the task's topic (comes from the automation's topics or is written by hand)
};
// Planned post: which account, which format, what it will tell. When prepared, Claude writes it from the brief.
// accountId may be empty: then format is the chosen platform; if there is no format either, Rou picks the account while preparing (shared/social.mjs pickAccount).
export type PlannedPost = { accountId: string; format?: PostFormat; brief: string; pillar?: string; at?: string };

// Time reserved on the calendar. Local time: "YYYY-MM-DDTHH:MM".
export type Block = { id: string; taskId: string | null; worldId: string; title: string; start: string; end: string; kind: "plan" | "meeting" };

// Time actually worked. ISO time.
export type Session = { id: string; taskId: string; start: string; end: string; mode: "free" | "pomo" | "manual" };

export type InboxItem = {
  id: string;
  worldId: string | null;
  projectId?: string | null; // if the note was put in a project (its world is the project's world)
  source: "note" | "mail" | "slack" | "clickup" | "claude" | string;
  from: string;
  url: string;
  title: string;
  body: string;
  receivedAt: string;
  suggestion?: { title: string; projectId?: string | null; day?: string | null; deadline?: string | null };
  state: "new" | "done";
  category?: NoteCategory; // "note" if unset
  taskId?: string; // the task created if it was turned into a task
  autoId?: string; // if it was turned into an automation
};
export type NoteCategory = "note" | "idea" | "todo" | "link";

// Automation: opens that day's task for each time on the chosen days (shared/repeat.mjs).
// If who = "claude", Claude prepares each task's output (Run) and the user approves.
// A step of the automation: what to do, with which tool, where (which account when sharing).
// The bot that prepares (who) does its own steps; the others fall to you as a checklist on every task.
export type StepKind = "text" | "image" | "video" | "post" | "other";
export type Step = { id: string; kind: StepKind; tool: string; account?: string; note?: string };
export type Automation = {
  id: string;
  every?: { hours: number; from: string; to: string }; // interval: every N hours between from and to (times are generated from this)
  worldId: string;
  projectId: string | null;
  title: string;
  action: string; // instruction to Claude
  times: string[]; // ["08:00", "20:00"]; if empty, no time
  minutes: number;
  days: number[]; // 0=Sun … 6=Sat
  status: "active" | "paused";
  who: "me" | "claude";
  accountId?: string; // which of the project's accounts it is shared on; the first account if unset
  platforms?: string[]; // where it is shared when no account is linked (instagram, tiktok, x...); once an account is linked, the account's applies
  format?: PostFormat; // the post's format; the first format of the account's platform if unset
  formats?: PostFormat[]; // formats in sequence (e.g. ig_reel, ig_post); each run takes the next one
  formatsFrom?: string; // the day the sequence count starts; createdAt if unset
  steps?: Step[];
  browser?: { id: string; name: string }; // works in Chrome (server/browse.mjs): reads and suggests while preparing, acts once approved
  folder?: string; // files go to the working folder › <folder or title>
  output?: "text" | "post" | "video" | "report"; // the output type when no account is linked (shared/stages.mjs)
  approve?: false; // does not wait for approval: the task finishes when the output arrives (e.g. weekly report)
  visual?: string; // permanent visual/cover rules (from the user's revisions): applied to every visual of this automation
  attach?: "image" | "video"; // attachment for a text post (LinkedIn, X, Threads): Rou also produces a single image or a vertical video
  voice?: "me"; // video in the user's own voice: once the text is prepared, the voice recording falls to them
  horizon: string | null; // the last day its task was opened
  ideas?: { at: string; by?: string; asked?: string; phase?: string; error?: string; items?: { title: string; brief: string; why: string; trend?: string; url?: string }[] }; // content ideas (server/ideas.mjs)
  createdAt: string;
  color?: string; // series color (hex, shared/series.mjs): accent on this series' covers and slides; a color dot in lists
  sharer?: "claude" | "me"; // who shares (default Rou); me: the user shares it themselves and says "I shared it"
  autoShare?: boolean; // an approved post is shared by itself at its time; if off, it waits for "Share now"
  topics?: Record<string, Topic>; // topics of future runs, key "YYYY-MM-DD HH:MM" (shared/repeat.mjs topicKey); passed to the task when it is opened
};
// A post's topic known in advance: title and what it will tell. Rou suggests it or the user writes it; Rou writes to it when preparing.
export type Topic = { title: string; brief: string; source?: string }; // source: address or file of the real work to show (server/plan.mjs)
// A task's prepared output. images: files under data/media; on: sharing day; by: who prepared it (claude, me...).
export type Run = {
  id: string;
  taskId?: string;
  at: string;
  title: string;
  body: string;
  status: "working" | "failed" | "ready" | "approved" | "posted" | "acted";
  plan?: false; // Rou's direct single task: no plan to approve (server/browse.mjs startDirect)
  images?: string[];
  video?: string; // media/<file>.mp4 (Reels)
  asIs?: boolean; // the task's own files are shared as they are (no template drawn); post.slides is not used
  order?: string[]; // order of video and images in an Instagram carousel (as Rou gave it); video first if unset
  copyOf?: string; // the source output it was copied from to another account (shared/revise.mjs copyPost)
  cover?: string; // the video's cover frame (media/<file>.png)
  voice?: string; // media/<file>: the voice the user read (a.voice === "me")
  transcript?: string; // transcript of the voice (server/voice.mjs)
  post?: Post; // structured form of the social post; the preview is drawn from it, body is the text to copy
  attach?: Post; // attachment of a text post: the image's slide (ig_post, 1 slide) or the video's scenes (short); regeneration is from this
  renderError?: string; // why the image/video could not be made
  needs?: string[]; // things Rou says would clearly improve the visual but are not available (logo, real screenshot...)
  review?: { score?: number; notes?: string[]; rounds?: number }; // score Rou gave after looking at the frames (server/prepare.mjs polish)
  phase?: string; // which step while preparing: "Writing", "Checking", "Preparing video"
  queued?: string; // a new revision arrived while this preparation was running: starts by itself when it finishes (server/prepare.mjs queueAfter)
  footage?: { key: string; from: number; sec: number; why?: string }; // the gameplay excerpt chosen in a revision
  on?: string | null;
  by?: string;
  template?: string; // visual/video template (render/src/look.tsx TEMPLATES); "night" if unset
  edited?: boolean; // the user edited it
  versions?: { at: string; why: string; post?: Post; attach?: Post; body?: string; images?: string[]; video?: string; template?: string }[]; // older states (shared/versions.mjs), newest first
  kitHash?: string; // which kit the visuals were drawn with; when the kit changes, visuals awaiting approval are redrawn (server/schedule.mjs)
  slim?: boolean; // retention: for a shared post older than 90 days the images were shrunk and the video removed (server/retention.mjs)
  publish?: { phase?: string; error?: string; at: string; live?: Live; by?: "claude"; handoff?: boolean; reason?: string; dir?: string }; // being shared, could not be shared, or left to the user (handoff: package is in the share folder)
  tried?: "claude"[]; // those who tried to share (fallback chain)
  approvedVia?: "auto"; // the scheduler approved it (approve: false)
  reviseNote?: string;
  answers?: string; // which revision note this output answers (revisions[].at)
  found?: { from: string; note: string; fix?: string; facts?: string[] }; // source of the images Rou found on the computer and attached
  topicMiss?: string; // The topic was not in the source: Rou wrote the closest real content; this is the reason (the topic-mismatch line stripped from the text)
  reviseGaps?: { ask: string; why: string }[]; // revision requests Rou could not do, and why
  shareSentAt?: string; // sharing started (the scheduler starts it once)
  approvedAt?: string; // approved
  postedAt?: string; // shared
  postUrl?: string;
  items?: RunItem[]; // what the Chrome automation suggested; the picked ones are done on approval
  act?: { phase?: string; error?: string; note?: string; at: string; question?: string; url?: string; loggedOut?: string; qa?: { q: string; a: string }[]; live?: Live }; // action turn (Rou does a single task: questions and answers, last page)
  live?: Live; // live steps while preparing in Chrome
};
// files: paths relative to the automation's folder. answer: the user's answer to the question asked in the previous attempt.
export type RunItem = { id: string; title: string; detail: string; url?: string; files?: string[]; score?: number; pick: boolean; answer?: string; result?: { done: boolean; at: string; note?: string; question?: string; url?: string } };

// When paused: base = seconds counted up to that moment, pausedAt = moment of the pause. On resume, startedAt becomes the start of the new segment.
// carry = seconds not yet written to a session because they were under 1 min (src/timer.ts commit).
export type Timer = { taskId: string; startedAt: string; mode: "free" | "pomo"; phase: "focus" | "break"; length: number; round: number; base?: number; pausedAt?: string; carry?: number };

export type State = {
  version: 3;
  worlds: World[];
  projects: Project[];
  tasks: Task[];
  blocks: Block[];
  sessions: Session[];
  inbox: InboxItem[];
  timer: Timer | null;
  automations: Automation[];
  runs: Run[];
  talk?: Talk[]; // external proposal channel (pg propose)
  notices?: Notice[]; // system feedback, newest first (shared/notices.mjs): bell and Rou chat
  rous?: Rou[]; // the Rous (shared/rou.mjs); the first is the default Rou
  writingGuide?: { text: string; at: string }; // writing guide given in chat; shared/guide.mjs guideOf overrides the code
  chatSummary?: Record<string, { text: string; upTo: string; at: string }>; // server/rou.mjs summarize: summary of the conversation that fell outside the last 12 messages
  chat?: Record<string, ChatMsg[]>; // chats by Rou id (browser and desktop app see the same history)
  chatFrom?: string; // "New chat" on the default Rou: earlier channel messages are hidden in the chat
  memory?: Memory[]; // what the Rous remember about the user
  trash?: Bin[]; // Trash, 30 days (shared/trash.mjs)
  change?: { id: string; text: string; phase: string; at: string; rouId?: string; done?: boolean; error?: string; restart?: boolean; code?: boolean; waiting?: boolean }; // status of the code change Rou made (server/change.mjs)
  changes?: { id: string; text: string; sha?: string; at: string; undone?: boolean; error?: string }[]; // without sha it was a data-only job; error: failed
  settings?: { userName?: string; workHints?: string; workDirs?: string[]; llm?: "claude" | "codex" | "gemini" }; // Settings: the user's name (Rou prompts), where their work lives, and folders Rou may read
  changeQueue?: { id: string; text: string; rouId: string; at: string; tries?: number }[]; // changes approved and waiting their turn
};

// A file attached to Rou: served as data/media/<file>, /media/<file>.
export type Att = { file: string; name: string; kind: "image" | "video" | "audio" | "file" };
export type ChatMsg = { role: "user" | "rou"; text: string; at?: string; error?: boolean; action?: { type: string; [k: string]: unknown }; act?: "done" | "no"; show?: string[]; files?: Att[] };
// without rouId it is a shared memory: all Rous know it.
export type Memory = { id: string; text: string; at: string; rouId?: string };
// persona: the task instruction the user gave this Rou. If color is empty, black.
export type Rou = { id: string; name: string; color: string; persona: string };
export type Bin = {
  id: string;
  kind: "world" | "project" | "task" | "auto" | "run" | "note" | "account" | "source";
  title: string;
  at: string;
  recs: Partial<Pick<State, "worlds" | "projects" | "tasks" | "blocks" | "sessions" | "inbox" | "automations" | "runs">> & {
    account?: { worldId: string; acc: Account; projectIds?: string[] };
    source?: { projectId: string; src: Source };
  };
};

// A message in the channel. Its proposal (action) is applied when the user approves; act is their decision.
// from "agent": an outside tool (Claude Code, MCP, a tool connected later) left a proposal with `pg propose`; name is the tool's name.
// Notification: shared, could not share, left to you, waiting for approval, could not prepare. Buttons come from the task's current state (noticeCtas).
export type Notice = { id: string; at: string; kind: "posted" | "share_failed" | "handoff" | "ready" | "failed" | "ask"; title: string; text?: string; by?: "claude"; runId?: string; taskId?: string; worldId?: string; read?: boolean };
export type Talk = { id: string; from: "rou" | "agent"; name?: string; text: string; at: string; action?: { type: string; [k: string]: unknown }; act?: "done" | "no"; show?: string[] };
