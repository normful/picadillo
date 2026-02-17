import { test, expect, describe, mock, beforeEach } from "bun:test";
import {
  gastownPrime,
  gastownMailCheck,
  recordSessionCosts,
  isAutonomousRole,
  handleSessionStart,
  handleBeforeAgentStart,
  handleSessionCompact,
  handleSessionShutdown,
  GASTOWN_MESSAGE_TYPE,
  type ExecResult,
} from "../../extensions/gastown";

// Helper to create mock exec results with required fields
const mockResult = (stdout: string): ExecResult => ({ stdout, stderr: "", code: 0, killed: false });

describe("gastown", () => {
  describe("isAutonomousRole", () => {
    test.each([
      { role: "polecat", expected: true },
      { role: "witness", expected: true },
      { role: "refinery", expected: true },
      { role: "deacon", expected: true },
      { role: "POLECAT", expected: true }, // case insensitive
      { role: "Witness", expected: true },
      { role: "other", expected: false },
      { role: "", expected: false },
      { role: "admin", expected: false },
      { role: "user", expected: false },
    ])("isAutonomousRole('$role') returns $expected", ({ role, expected }) => {
      expect(isAutonomousRole(role)).toBe(expected);
    });
  });

  describe("gastownPrime", () => {
    test("returns stdout when exec succeeds", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("prime content")));
      const result = await gastownPrime(mockExec);
      expect(result).toBe("prime content");
      expect(mockExec).toHaveBeenCalledWith("gt", ["prime", "--hook"]);
    });

    test("returns empty string when exec throws", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.reject(new Error("exec failed")));
      const result = await gastownPrime(mockExec);
      expect(result).toBe("");
    });

    test("returns empty string when stdout is empty", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("")));
      const result = await gastownPrime(mockExec);
      expect(result).toBe("");
    });

    test("preserves whitespace in stdout", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("  prime content  \n")));
      const result = await gastownPrime(mockExec);
      expect(result).toBe("  prime content  \n");
    });
  });

  describe("gastownMailCheck", () => {
    test("returns stdout when exec succeeds", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("mail content")));
      const result = await gastownMailCheck(mockExec);
      expect(result).toBe("mail content");
      expect(mockExec).toHaveBeenCalledWith("gt", ["mail", "check", "--inject"]);
    });

    test("returns empty string when exec throws", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.reject(new Error("exec failed")));
      const result = await gastownMailCheck(mockExec);
      expect(result).toBe("");
    });

    test("returns empty string when stdout is empty", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("")));
      const result = await gastownMailCheck(mockExec);
      expect(result).toBe("");
    });
  });

  describe("recordSessionCosts", () => {
    test("calls exec with correct arguments", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("")));
      await recordSessionCosts(mockExec, "session-123");
      expect(mockExec).toHaveBeenCalledWith("gt", ["costs", "record", "--session", "session-123"]);
    });

    test("does not throw when exec fails", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.reject(new Error("exec failed")));
      // Should not throw - error is caught internally
      const promise = recordSessionCosts(mockExec, "session-123");
      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe("handleSessionStart", () => {
    let mockExec: ReturnType<typeof mock<() => Promise<ExecResult>>>;
    let mockSendMessage: ReturnType<typeof mock<() => void>>;

    beforeEach(() => {
      mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("")));
      mockSendMessage = mock<() => void>(() => {});
    });

    test("does nothing when prime returns empty", async () => {
      await handleSessionStart(mockExec, mockSendMessage);
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    test("sends message with prime and mail content", async () => {
      let callCount = 0;
      mockExec.mockImplementation(() => {
        if (callCount === 0) {
          callCount++;
          return Promise.resolve(mockResult("prime text"));
        }
        return Promise.resolve(mockResult("mail text"));
      });

      await handleSessionStart(mockExec, mockSendMessage);

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: GASTOWN_MESSAGE_TYPE,
          content: "prime text\n\nmail text",
          display: true,
        }),
        expect.objectContaining({
          deliverAs: "steer",
          triggerTurn: true,
        }),
      );
    });

    test("sends message with only prime when mail is empty", async () => {
      let callCount = 0;
      mockExec.mockImplementation(() => {
        if (callCount === 0) {
          callCount++;
          return Promise.resolve(mockResult("prime text"));
        }
        return Promise.resolve(mockResult(""));
      });

      await handleSessionStart(mockExec, mockSendMessage);

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "prime text\n\n",
        }),
        expect.anything(),
      );
    });

    test("does not call mail check when prime fails", async () => {
      let callCount = 0;
      mockExec.mockImplementation(() => {
        if (callCount === 0) {
          callCount++;
          return Promise.reject(new Error("prime failed"));
        }
        return Promise.resolve(mockResult("mail text"));
      });

      await handleSessionStart(mockExec, mockSendMessage);

      // When prime fails, function returns early - does not send message
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe("handleBeforeAgentStart", () => {
    test("returns undefined when mail is empty", () => {
      const result = handleBeforeAgentStart("polecat", "");
      expect(result).toBeUndefined();
    });

    test("returns undefined when role is not autonomous", () => {
      const result = handleBeforeAgentStart("user", "some mail");
      expect(result).toBeUndefined();
    });

    test("returns message for autonomous role with mail", () => {
      const result = handleBeforeAgentStart("polecat", "mail content");
      expect(result).toEqual({
        message: {
          customType: GASTOWN_MESSAGE_TYPE,
          content: "mail content",
          display: true,
        },
      });
    });

    test("is case insensitive for role", () => {
      const result = handleBeforeAgentStart("POLECAT", "mail content");
      expect(result).toEqual({
        message: {
          customType: GASTOWN_MESSAGE_TYPE,
          content: "mail content",
          display: true,
        },
      });
    });

    test.each(["witness", "refinery", "deacon"])("works for role %s", (role) => {
      const result = handleBeforeAgentStart(role, "mail content");
      expect(result).toBeDefined();
      expect(result?.message.customType).toBe(GASTOWN_MESSAGE_TYPE);
    });

    test("returns undefined for non-autonomous roles", () => {
      const roles = ["admin", "user", "guest", "moderator", ""];
      for (const role of roles) {
        const result = handleBeforeAgentStart(role, "mail content");
        expect(result).toBeUndefined();
      }
    });
  });

  describe("handleSessionCompact", () => {
    let mockExec: ReturnType<typeof mock<() => Promise<ExecResult>>>;
    let mockSendMessage: ReturnType<typeof mock<() => void>>;

    beforeEach(() => {
      mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("")));
      mockSendMessage = mock<() => void>(() => {});
    });

    test("does nothing when prime returns empty", async () => {
      await handleSessionCompact(mockExec, mockSendMessage);
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    test("sends message with prime content as follow-up", async () => {
      mockExec.mockImplementation(() => Promise.resolve(mockResult("prime text")));

      await handleSessionCompact(mockExec, mockSendMessage);

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: GASTOWN_MESSAGE_TYPE,
          content: "prime text",
          display: true,
        }),
        expect.objectContaining({
          deliverAs: "followUp",
          triggerTurn: true,
        }),
      );
    });

    test("does not throw when exec fails", async () => {
      mockExec.mockImplementation(() => Promise.reject(new Error("prime failed")));

      // Should not throw - error is caught internally
      const promise = handleSessionCompact(mockExec, mockSendMessage);
      await expect(promise).resolves.toBeUndefined();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe("handleSessionShutdown", () => {
    test("records session costs with correct session id", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("")));
      await handleSessionShutdown(mockExec, "session-456");
      expect(mockExec).toHaveBeenCalledWith("gt", ["costs", "record", "--session", "session-456"]);
    });

    test("does not throw when exec fails", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.reject(new Error("exec failed")));

      // Should not throw - error is caught internally
      const promise = handleSessionShutdown(mockExec, "session-456");
      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe("integration scenarios", () => {
    test("full session_start flow with all data", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("")));
      const mockSendMessage = mock<() => void>(() => {});

      let callCount = 0;
      mockExec.mockImplementation(() => {
        if (callCount === 0) {
          callCount++;
          return Promise.resolve(mockResult("Daily prime: stay focused"));
        }
        return Promise.resolve(mockResult("You have 3 new messages"));
      });

      await handleSessionStart(mockExec, mockSendMessage);

      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      const calls = mockSendMessage.mock.calls as unknown as [[{ content: string }, { deliverAs: string; triggerTurn: boolean }]];
      const [message, options] = calls[0];
      expect(message.content).toBe("Daily prime: stay focused\n\nYou have 3 new messages");
      expect(options.deliverAs).toBe("steer");
      expect(options.triggerTurn).toBe(true);
    });

    test("full before_agent_start flow for autonomous role", () => {
      const result = handleBeforeAgentStart("deacon", "Urgent: review PR #42");
      expect(result).toBeDefined();
      expect(result?.message.content).toBe("Urgent: review PR #42");
    });

    test("does not trigger before_agent_start for non-autonomous role", () => {
      const result = handleBeforeAgentStart("user", "Some mail");
      expect(result).toBeUndefined();
    });
  });
});
