import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ExecResult } from "@mariozechner/pi-coding-agent";

export type { ExecResult };
export const OVERSTORY_MESSAGE_TYPE = "overstory";

export async function overstoryPrime(
  execFn: ExtensionAPI["exec"],
  forCompact = false,
): Promise<string> {
  let primeText = "";
  try {
    const { stdout } = await execFn("overstory", [
      "prime",
      "--agent",
      "coordinator",
      ...(forCompact ? ["--compact"] : []),
    ]);
    primeText = stdout;
  } catch (e) {
    console.error("overstory prime failed:", e);
  }
  return primeText;
}

export async function overstoryMailCheck(
  execFn: ExtensionAPI["exec"],
): Promise<string> {
  let mailText = "";
  try {
    const { stdout } = await execFn("overstory", [
      "mail",
      "check",
      "--inject",
      "--agent",
      "coordinator",
    ]);
    mailText = stdout;
  } catch (e) {
    console.error("overstory mail check failed:", e);
  }
  return mailText;
}

export async function logToolStart(
  execFn: ExtensionAPI["exec"],
  toolName: string,
): Promise<void> {
  try {
    await execFn("overstory", [
      "log",
      "tool-start",
      "--agent",
      "coordinator",
      "--tool-name",
      toolName,
    ]);
  } catch (e) {
    console.error("overstory log tool-start failed:", e);
  }
}

export async function logToolEnd(
  execFn: ExtensionAPI["exec"],
  toolName: string,
): Promise<void> {
  try {
    await execFn("overstory", [
      "log",
      "tool-end",
      "--agent",
      "coordinator",
      "--tool-name",
      toolName,
    ]);
  } catch (e) {
    console.error("overstory log tool-end failed:", e);
  }
}

export async function logSessionEnd(
  execFn: ExtensionAPI["exec"],
): Promise<void> {
  try {
    await execFn("overstory", [
      "log",
      "session-end",
      "--agent",
      "coordinator",
    ]);
  } catch (e) {
    console.error("overstory log session-end failed:", e);
  }
}

export async function mulchLearn(
  execFn: ExtensionAPI["exec"],
): Promise<string> {
  let primeText = "";
  try {
    const { stdout } = await execFn("mulch", ["learn"]);
    primeText = stdout;
  } catch (e) {
    console.error("mulch learn failed:", e);
  }
  return primeText;
}

export async function handleSessionStart(
  execFn: ExtensionAPI["exec"],
  sendMessage: ExtensionAPI["sendMessage"],
): Promise<void> {
  const primeText = await overstoryPrime(execFn);
  if (!primeText) return;

  const mailText = await overstoryMailCheck(execFn);
  sendMessage(
    {
      customType: OVERSTORY_MESSAGE_TYPE,
      content: primeText + "\n\n" + mailText,
      display: true,
    },
    {
      deliverAs: "followUp",
      triggerTurn: true,
    },
  );
}

export function handleBeforeAgentStart(userPrompt: string, mailText: string) {
  const hasMail = Boolean(mailText);
  return {
    message: {
      customType: OVERSTORY_MESSAGE_TYPE,
      content: hasMail
        ? `${userPrompt}\n\n---\n\n INCOMING MAIL JUST RECEIVED\n\n${mailText}`
        : "",
      display: true,
    },
  };
}

export async function handleToolExecutionEnd(
  execFn: ExtensionAPI["exec"],
  event: { toolName: string },
): Promise<void> {
  logToolEnd(execFn, event.toolName);
}

export async function handleToolExecutionStart(
  execFn: ExtensionAPI["exec"],
  event: { toolName: string },
): Promise<void> {
  logToolStart(execFn, event.toolName);
}

export async function handleSessionCompact(
  execFn: ExtensionAPI["exec"],
  sendMessage: ExtensionAPI["sendMessage"],
): Promise<void> {
  const primeText = await overstoryPrime(execFn, true);
  if (!primeText) return;

  sendMessage(
    {
      customType: OVERSTORY_MESSAGE_TYPE,
      content: primeText,
      display: true,
    },
    {
      deliverAs: "followUp",
      triggerTurn: true,
    },
  );
}

export async function handleSessionShutdown(
  execFn: ExtensionAPI["exec"],
): Promise<void> {
  await Promise.all([logSessionEnd(execFn), mulchLearn(execFn)]);
}

export async function isOverstoryRepo(
  execFn: ExtensionAPI["exec"],
): Promise<boolean> {
  try {
    // Get the git repo root directory (fails if not in a git repo)
    const gitRootResult = await execFn("git", ["rev-parse", "--show-toplevel"]);
    const gitRoot = gitRootResult.stdout.trim();

    // Check if .overstory directory exists in the git repo root
    const overstoryDirResult = await execFn("ls", [
      "-d",
      `${gitRoot}/.overstory`,
    ]);
    if (overstoryDirResult.code !== 0) {
      return false; // No .overstory directory
    }
    return true;
  } catch (e) {
    return false; // Not in a git repo or other error
  }
}

export default async function (pi: ExtensionAPI) {
  if (!(await isOverstoryRepo(pi.exec))) {
    return;
  }

  pi.on("session_start", async (_event, _ctx) => {
    await handleSessionStart(pi.exec, pi.sendMessage);
  });

  pi.on("before_agent_start", async (event, _ctx) => {
    const mailText = await overstoryMailCheck(pi.exec);
    return handleBeforeAgentStart(event.prompt, mailText);
  });

  pi.on("tool_execution_end", async (event, _ctx) => {
    // Fire-and-forget: don't await, let it run in background
    void handleToolExecutionEnd(pi.exec, event);
  });

  pi.on("tool_execution_start", async (event, _ctx) => {
    // Fire-and-forget: don't await, let it run in background
    void handleToolExecutionStart(pi.exec, event);
  });

  pi.on("session_compact", async (_event, _ctx) => {
    await handleSessionCompact(pi.exec, pi.sendMessage);
  });

  pi.on("session_shutdown", async (_event, _ctx) => {
    await handleSessionShutdown(pi.exec);
  });
}
