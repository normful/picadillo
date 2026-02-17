import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ExecResult } from "@mariozechner/pi-coding-agent";

export type { ExecResult };
export const MULCH_MESSAGE_TYPE = "mulch";

const APPEND_TO_MULCH_PRIME = `
---

But you should NOT run any above mulch commands right now.
I am just letting you know the session close protocol, so that you remember to do it later.
`;

export async function mulchPrime(
  execFn: ExtensionAPI["exec"],
): Promise<string> {
  let primeText = "";
  try {
    const { stdout } = await execFn("mulch", ["prime"]);
    primeText = stdout;
  } catch (e) {
    console.error("mulch prime failed:", e);
  }
  return primeText;
}

export async function handleSessionStart(
  execFn: ExtensionAPI["exec"],
  sendMessage: ExtensionAPI["sendMessage"],
): Promise<void> {
  const primeText = await mulchPrime(execFn);
  if (!primeText) return;

  sendMessage(
    {
      customType: MULCH_MESSAGE_TYPE,
      content: primeText + APPEND_TO_MULCH_PRIME,
      display: true,
    },
    {
      deliverAs: "steer",
      triggerTurn: true,
    },
  );
}

export async function handleSessionCompact(
  execFn: ExtensionAPI["exec"],
  sendMessage: ExtensionAPI["sendMessage"],
): Promise<void> {
  const primeText = await mulchPrime(execFn);
  if (!primeText) return;

  sendMessage(
    {
      customType: MULCH_MESSAGE_TYPE,
      content: primeText + APPEND_TO_MULCH_PRIME,
      display: true,
    },
    {
      deliverAs: "followUp",
      triggerTurn: true,
    },
  );
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, _ctx) => {
    await handleSessionStart(pi.exec, pi.sendMessage);
  });

  pi.on("session_compact", async (_event, _ctx) => {
    await handleSessionCompact(pi.exec, pi.sendMessage);
  });
}
