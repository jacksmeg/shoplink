import { spawn } from "node:child_process";
import { join } from "node:path";

const viteBin = join("node_modules", "vite", "bin", "vite.js");
const children = [
  spawn(process.execPath, ["server/server.mjs"], {
    stdio: "inherit",
    env: { ...process.env, PORT: process.env.PORT || "8787" },
  }),
  spawn(process.execPath, [viteBin, "--host", "127.0.0.1"], {
    stdio: "inherit",
    env: process.env,
  }),
];

function shutdown(signal) {
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shutdown(signal);
    process.exit(0);
  });
}

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      shutdown("SIGTERM");
      process.exit(code);
    }
  });
}
