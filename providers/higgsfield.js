import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function safeExec(args, timeout = 5000) {
  const { stdout = "", stderr = "" } = await execFileAsync("higgsfield", args, {
    timeout,
    maxBuffer: 1024 * 1024
  });
  return `${stdout}${stderr}`.trim();
}

export async function higgsfieldStatus() {
  try {
    const help = await safeExec(["--help"]);
    return {
      installed: true,
      enabled: process.env.HIGGSFIELD_ENABLED === "true",
      authenticated: null,
      detail: help.slice(0, 400)
    };
  } catch (error) {
    return {
      installed: false,
      enabled: false,
      authenticated: false,
      detail: error.message
    };
  }
}

export async function inspectHiggsfieldModels() {
  try {
    const output = await safeExec(["model", "list"], 10000);
    return { ok: true, output: output.slice(0, 12000) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export async function renderWithHiggsfield() {
  if (process.env.HIGGSFIELD_ENABLED !== "true") {
    throw new Error("Paid Higgsfield generation is disabled. Set HIGGSFIELD_ENABLED=true only after authentication and render-cost validation.");
  }
  throw new Error("Live submission is intentionally gated until the authenticated CLI schema is inspected on the deployment host. No credits were spent.");
}
