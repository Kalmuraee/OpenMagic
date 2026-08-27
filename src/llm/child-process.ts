
import { execFileSync, type ChildProcess } from "node:child_process";

export function terminateChildProcessTree(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
  const pid = child.pid;
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else if (child.spawnargs.length) {
      process.kill(-pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    try { child.kill(signal); } catch {}
  }
}
