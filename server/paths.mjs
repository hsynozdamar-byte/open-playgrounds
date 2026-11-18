// Klasörler: paylaşım için bırakılan dosyalar ve Chrome işlerinin çıktıları.
// Ortam değişkeni verilmezse ~/Documents/Playgrounds altında durur.
import os from "node:os";
import path from "node:path";

const ROOT = path.join(os.homedir(), "Documents", "Playgrounds");
export const WORK_DIR = process.env.PG_WORK_DIR || ROOT;
export const SHARE_DIR = process.env.PG_SHARE_DIR || path.join(ROOT, "Paylaşılacak");
