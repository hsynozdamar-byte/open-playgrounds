// Data model. One JSON file (data/playground.json) is shared by the app, the `pg` CLI and any AI tool.
// World → Project → Task (+ checklist). Separate from tasks: Block (time reserved on the calendar),
// Session (time actually worked), Inbox (raw items waiting for a decision), Timer (one running focus session).

export type World = { id: string; name: string; color: string; color2?: string; description: string };

export type ProjectStatus = "active" | "paused" | "done";
// ongoing: a project with no deadline. sources: the project's knowledge (notes, uploaded text files, links).
export type Project = { id: string; worldId: string; name: string; description: string; status: ProjectStatus; deadline: string | null; ongoing?: boolean; sources?: Source[] };

// A project source: a note, an uploaded text file or a link. The content is stored in the data, never as a path on disk.
// use: hand it to AI tools as context (`pg context <projectId>`). Links are not fetched; the address and the note are stored.
export type SourceKind = "note" | "file" | "link";
export type Source = { id: string; kind: SourceKind; title: string; body: string; url?: string; use: boolean; addedAt: string };

export type TaskStatus = "todo" | "doing" | "waiting" | "done";
export type CheckItem = { id: string; text: string; done: boolean };
export type Task = {
  id: string;
  worldId: string;
  projectId: string | null;
  title: string;
  notes: string;
  status: TaskStatus;
  day: string | null; // the day you plan to do it (YYYY-MM-DD), no time
  deadline: string | null; // latest day
  estimate: number | null; // minutes
  checklist: CheckItem[];
  source?: { type: string; url: string; ref?: string };
  by: string; // "me", or the name of the tool that added it
  createdAt: string;
  doneAt?: string;
  order?: number; // manual order in the Today list
};

// Time reserved on the calendar. Local time: "YYYY-MM-DDTHH:MM".
export type Block = { id: string; taskId: string | null; worldId: string; title: string; start: string; end: string; kind: "plan" | "meeting" };

// Time actually worked. ISO time.
export type Session = { id: string; taskId: string; start: string; end: string; mode: "free" | "pomo" | "manual" };

export type InboxItem = {
  id: string;
  worldId: string | null;
  projectId?: string | null; // the note sits in a project (its world is the project's world)
  source: "note" | "mail" | "slack" | "agent" | string; // "agent": written by an AI tool through `pg in`
  from: string;
  url: string;
  title: string;
  body: string;
  receivedAt: string;
  suggestion?: { title: string; projectId?: string | null; day?: string | null; deadline?: string | null };
  state: "new" | "done";
  category?: NoteCategory; // default "note"
  taskId?: string; // the task it became
};
export type NoteCategory = "note" | "idea" | "todo" | "link";

// Paused: base = seconds counted so far, pausedAt = when it was paused. On resume startedAt is the start of the new part.
// carry = seconds not yet written as a session because the part was shorter than a minute (src/timer.ts commit).
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
  trash?: Bin[]; // Trash, kept 30 days (shared/trash.mjs)
};

export type Bin = {
  id: string;
  kind: "world" | "project" | "task" | "note" | "source";
  title: string;
  at: string;
  recs: Partial<Pick<State, "worlds" | "projects" | "tasks" | "blocks" | "sessions" | "inbox">> & {
    source?: { projectId: string; src: Source };
  };
};
