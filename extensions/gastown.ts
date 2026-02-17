import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ExecResult } from "@mariozechner/pi-coding-agent";

export type { ExecResult };
export const GASTOWN_MESSAGE_TYPE = "gastown";
export const AUTONOMOUS_ROLES = new Set(["polecat", "witness", "refinery", "deacon"]);

export interface GastownConfig {
  role?: string;
}

/**
 * Run `gt prime --hook` to get prime text.
 */
export async function gastownPrime(execFn: ExtensionAPI["exec"]): Promise<string> {
  let primeText = "";
  try {
    const { stdout } = await execFn("gt", ["prime", "--hook"]);
    primeText = stdout;
  } catch (e) {
    console.error("[gastown] gt prime failed:", e);
  }
  return primeText;
}

/**
 * Run `gt mail check --inject` to get mail text.
 */
export async function gastownMailCheck(execFn: ExtensionAPI["exec"]): Promise<string> {
  let mailText = "";
  try {
    const { stdout } = await execFn("gt", ["mail", "check", "--inject"]);
    mailText = stdout;
  } catch (e) {
    console.error("[gastown] gt mail check --inject failed:", e);
  }
  return mailText;
}

/**
 * Record session costs using `gt costs record --session <sessionId>`.
 */
export async function recordSessionCosts(
  execFn: ExtensionAPI["exec"],
  sessionId: string,
): Promise<void> {
  try {
    await execFn("gt", ["costs", "record", "--session", sessionId]);
  } catch (e) {
    console.error("[gastown] gt costs record failed:", e);
  }
}

/**
 * Check if the given role is an autonomous role.
 */
export function isAutonomousRole(role: string): boolean {
  return AUTONOMOUS_ROLES.has(role.toLowerCase());
}

/**
 * Handle session_start event.
 * Fetches prime text and mail, sends combined message.
 */
export async function handleSessionStart(
  execFn: ExtensionAPI["exec"],
  sendMessage: ExtensionAPI["sendMessage"],
): Promise<void> {
  const primeText = await gastownPrime(execFn);
  if (!primeText) return;

  const mailText = await gastownMailCheck(execFn);
  sendMessage(
    {
      customType: GASTOWN_MESSAGE_TYPE,
      content: primeText + "\n\n" + mailText,
      display: true,
    },
    {
      deliverAs: "steer",
      triggerTurn: true,
    },
  );
}

/**
 * Handle before_agent_start event.
 * Sends mail text only for autonomous roles.
 */
export function handleBeforeAgentStart(
  role: string,
  mailText: string,
): { message: { customType: string; content: string; display: boolean } } | undefined {
  if (!mailText || !isAutonomousRole(role)) return undefined;

  return {
    message: {
      customType: GASTOWN_MESSAGE_TYPE,
      content: mailText,
      display: true,
    },
  };
}

/**
 * Handle session_compact event.
 * Fetches prime text and sends as follow-up.
 */
export async function handleSessionCompact(
  execFn: ExtensionAPI["exec"],
  sendMessage: ExtensionAPI["sendMessage"],
): Promise<void> {
  const primeText = await gastownPrime(execFn);
  if (!primeText) return;

  sendMessage(
    {
      customType: GASTOWN_MESSAGE_TYPE,
      content: primeText,
      display: true,
    },
    {
      deliverAs: "followUp",
      triggerTurn: true,
    },
  );
}

/**
 * Handle session_shutdown event.
 * Records session costs.
 */
export async function handleSessionShutdown(
  execFn: ExtensionAPI["exec"],
  sessionId: string,
): Promise<void> {
  await recordSessionCosts(execFn, sessionId);
}

export default function (pi: ExtensionAPI) {
  const role = (process.env.GT_ROLE || "").toLowerCase();

  pi.on("session_start", async (_event, _ctx) => {
    await handleSessionStart(pi.exec, pi.sendMessage);
  });

  pi.on("before_agent_start", async (_event, _ctx) => {
    const mailText = await gastownMailCheck(pi.exec);
    return handleBeforeAgentStart(role, mailText);
  });

  pi.on("session_compact", async (_event, _ctx) => {
    await handleSessionCompact(pi.exec, pi.sendMessage);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    await handleSessionShutdown(pi.exec, sessionId);
  });
}
