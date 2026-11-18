// Sunucuyu (app.mjs) çalıştırır ve gözetir: npm start, masaüstü uygulaması. Rou sunucu kodunu değiştirince app.mjs 75 koduyla çıkar,
// burada yeni koduyla yeniden başlar. Başka bir çıkışta bu süreç de aynı kodla çıkar; SIGTERM/SIGINT çocuğa iletilir.
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
