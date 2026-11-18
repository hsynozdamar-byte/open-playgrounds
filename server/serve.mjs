// Runs and supervises the server (app.mjs): npm start, the desktop app. When Rou changes server code, app.mjs exits with code 75
// and is restarted here with the new code. On any other exit this process exits with the same code; SIGTERM/SIGINT go to the child.
import { spawn } from "node:child_process";
import path from "node:path";

const APP = path.resolve(import.meta.dirname, "app.mjs");
let child;
const run = () => {
  child = spawn(process.execPath, [APP], { stdio: "inherit", env: { ...process.env, PG_SUPERVISED: "1" } });
  child.on("exit", (code, sig) => (code === 75 ? run() : process.exit(code ?? (sig ? 1 : 0))));
};
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, () => child?.kill(sig));
run();
