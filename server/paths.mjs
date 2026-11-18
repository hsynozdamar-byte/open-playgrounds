// Folders: files left for sharing and the output of Chrome jobs.
// Under ~/Documents/Playgrounds unless an environment variable says otherwise.
import os from "node:os";
import path from "node:path";

const ROOT = path.join(os.homedir(), "Documents", "Playgrounds");
export const WORK_DIR = process.env.PG_WORK_DIR || ROOT;
export const SHARE_DIR = process.env.PG_SHARE_DIR || path.join(ROOT, "To share");
