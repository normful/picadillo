import { test, expect, describe, mock, beforeEach } from "bun:test";
import {
  overstoryPrime,
  overstoryMailCheck,
  logToolStart,
  logToolEnd,
  logSessionEnd,
  mulchLearn,
  handleSessionStart,
  handleBeforeAgentStart,
  handleToolExecutionEnd,
  handleToolExecutionStart,
  handleSessionCompact,
  handleSessionShutdown,
  isOverstoryRepo,
  OVERSTORY_MESSAGE_TYPE,
  type ExecResult,
} from "../../extensions/overstory";

// Helper to create mock exec results with required fields
const mockResult = (stdout: string): ExecResult => ({ stdout, stderr: "", code: 0, killed: false });

describe("overstory", () => {
  describe("overstoryPrime", () => {
    test("returns stdout when exec succeeds", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("prime content")));
      const result = await overstoryPrime(mockExec);
      expect(result).toBe("prime content");
      expect(mockExec).toHaveBeenCalledWith("overstory", ["prime", "--agent", "coordinator"]);
    });

    test("returns stdout with compact flag when forCompact is true", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("compact prime")));
      const result = await overstoryPrime(mockExec, true);
      expect(result).toBe("compact prime");
      expect(mockExec).toHaveBeenCalledWith("overstory", ["prime", "--agent", "coordinator", "--compact"]);
    });

    test("returns empty string when exec throws", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.reject(new Error("exec failed")));
      const result = await overstoryPrime(mockExec);
      expect(result).toBe("");
    });

    test("returns empty string when stdout is empty", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("")));
      const result = await overstoryPrime(mockExec);
      expect(result).toBe("");
    });

    test("preserves whitespace in stdout", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("  prime content  \n")));
      const result = await overstoryPrime(mockExec);
      expect(result).toBe("  prime content  \n");
    });
  });

  describe("overstoryMailCheck", () => {
    test("returns stdout when exec succeeds", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("mail content")));
      const result = await overstoryMailCheck(mockExec);
      expect(result).toBe("mail content");
      expect(mockExec).toHaveBeenCalledWith("overstory", ["mail", "check", "--inject", "--agent", "coordinator"]);
    });

    test("returns empty string when exec throws", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.reject(new Error("exec failed")));
      const result = await overstoryMailCheck(mockExec);
      expect(result).toBe("");
    });

    test("returns empty string when stdout is empty", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("")));
      const result = await overstoryMailCheck(mockExec);
      expect(result).toBe("");
    });
  });

  describe("logToolStart", () => {
    test("calls exec with correct arguments", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("")));
      await logToolStart(mockExec, "read-file");
      expect(mockExec).toHaveBeenCalledWith("overstory", ["log", "tool-start", "--agent", "coordinator", "--tool-name", "read-file"]);
    });

    test("does not throw when exec fails", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.reject(new Error("exec failed")));
      // Should not throw - error is caught internally
      const promise = logToolStart(mockExec, "my-tool");
      await expect(promise).resolves.toBeUndefined();
    });

    test("works with various tool names", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("")));
      await logToolStart(mockExec, "bash");
      await logToolStart(mockExec, "edit");
      await logToolStart(mockExec, "write");

      expect(mockExec).toHaveBeenCalledTimes(3);
      expect(mockExec).toHaveBeenCalledWith("overstory", ["log", "tool-start", "--agent", "coordinator", "--tool-name", "bash"]);
    });
  });

  describe("logToolEnd", () => {
    test("calls exec with correct arguments", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("")));
      await logToolEnd(mockExec, "read-file");
      expect(mockExec).toHaveBeenCalledWith("overstory", ["log", "tool-end", "--agent", "coordinator", "--tool-name", "read-file"]);
    });

    test("does not throw when exec fails", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.reject(new Error("exec failed")));
      const promise = logToolEnd(mockExec, "my-tool");
      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe("logSessionEnd", () => {
    test("calls exec with correct arguments", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("")));
      await logSessionEnd(mockExec);
      expect(mockExec).toHaveBeenCalledWith("overstory", ["log", "session-end", "--agent", "coordinator"]);
    });

    test("does not throw when exec fails", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.reject(new Error("exec failed")));
      const promise = logSessionEnd(mockExec);
      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe("mulchLearn", () => {
    test("returns stdout when exec succeeds", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("learned successfully")));
      const result = await mulchLearn(mockExec);
      expect(result).toBe("learned successfully");
      expect(mockExec).toHaveBeenCalledWith("mulch", ["learn"]);
    });

    test("returns empty string when exec throws", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.reject(new Error("exec failed")));
      const result = await mulchLearn(mockExec);
      expect(result).toBe("");
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
          customType: OVERSTORY_MESSAGE_TYPE,
          content: "prime text\n\nmail text",
          display: true,
        }),
        expect.objectContaining({
          deliverAs: "followUp",
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

    test("does not send message when prime fails", async () => {
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
    test("returns message with userPrompt and mail content", () => {
      const result = handleBeforeAgentStart("fix the bug", "You have 5 new messages");
      expect(result).toEqual({
        message: {
          customType: OVERSTORY_MESSAGE_TYPE,
          content: "fix the bug\n\n---\n\n INCOMING MAIL JUST RECEIVED\n\nYou have 5 new messages",
          display: true,
        },
      });
    });

    test("returns empty string when no mail", () => {
      const result = handleBeforeAgentStart("fix the bug", "");
      expect(result).toEqual({
        message: {
          customType: OVERSTORY_MESSAGE_TYPE,
          content: "",
          display: true,
        },
      });
    });

    test("returns message with mail only when userPrompt is empty but mail exists", () => {
      const result = handleBeforeAgentStart("", "You have mail");
      // When userPrompt is empty but mail exists, it becomes just the mail part
      expect(result).toEqual({
        message: {
          customType: OVERSTORY_MESSAGE_TYPE,
          content: "\n\n---\n\n INCOMING MAIL JUST RECEIVED\n\nYou have mail",
          display: true,
        },
      });
    });

    test("returns empty message when both are empty", () => {
      const result = handleBeforeAgentStart("", "");
      expect(result).toEqual({
        message: {
          customType: OVERSTORY_MESSAGE_TYPE,
          content: "",
          display: true,
        },
      });
    });
  });

  describe("handleToolExecutionStart", () => {
    test("calls logToolStart with tool name from event", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("")));
      await handleToolExecutionStart(mockExec, { toolName: "bash" });
      expect(mockExec).toHaveBeenCalledWith("overstory", ["log", "tool-start", "--agent", "coordinator", "--tool-name", "bash"]);
    });

    test("does not throw when exec fails", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.reject(new Error("exec failed")));
      const promise = handleToolExecutionStart(mockExec, { toolName: "my-tool" });
      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe("handleToolExecutionEnd", () => {
    test("calls logToolEnd with tool name from event", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("")));
      await handleToolExecutionEnd(mockExec, { toolName: "read" });
      expect(mockExec).toHaveBeenCalledWith("overstory", ["log", "tool-end", "--agent", "coordinator", "--tool-name", "read"]);
    });

    test("does not throw when exec fails", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.reject(new Error("exec failed")));
      const promise = handleToolExecutionEnd(mockExec, { toolName: "my-tool" });
      await expect(promise).resolves.toBeUndefined();
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
      mockExec.mockImplementation(() => Promise.resolve(mockResult("compact prime text")));

      await handleSessionCompact(mockExec, mockSendMessage);

      // Verify prime was called with --compact flag
      expect(mockExec).toHaveBeenCalledWith("overstory", ["prime", "--agent", "coordinator", "--compact"]);

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: OVERSTORY_MESSAGE_TYPE,
          content: "compact prime text",
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
    test("calls both logSessionEnd and mulchLearn in parallel", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("")));
      await handleSessionShutdown(mockExec);

      // Both functions should be called
      expect(mockExec).toHaveBeenCalledTimes(2);
      expect(mockExec).toHaveBeenCalledWith("overstory", ["log", "session-end", "--agent", "coordinator"]);
      expect(mockExec).toHaveBeenCalledWith("mulch", ["learn"]);
    });

    test("does not throw when exec fails", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.reject(new Error("exec failed")));

      // Should not throw - error is caught internally
      const promise = handleSessionShutdown(mockExec);
      await expect(promise).resolves.toBeUndefined();
    });

    test("calls both functions even if one fails", async () => {
      let callCount = 0;
      const mockExec = mock<() => Promise<ExecResult>>(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error("first failed"));
        }
        return Promise.resolve(mockResult(""));
      });

      await handleSessionShutdown(mockExec);
      // Both calls should have been attempted
      expect(mockExec).toHaveBeenCalledTimes(2);
    });
  });

  describe("isOverstoryRepo", () => {
    test("returns true when in a git repo with .overstory directory", async () => {
      let callCount = 0;
      const mockExec = mock<() => Promise<ExecResult>>(() => {
        callCount++;
        if (callCount === 1) {
          // git rev-parse --show-toplevel
          return Promise.resolve(mockResult("/home/user/my-repo\n"));
        }
        // ls -d /home/user/my-repo/.overstory
        return Promise.resolve(mockResult("/home/user/my-repo/.overstory"));
      });

      const result = await isOverstoryRepo(mockExec);
      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith("git", ["rev-parse", "--show-toplevel"]);
      expect(mockExec).toHaveBeenCalledWith("ls", ["-d", "/home/user/my-repo/.overstory"]);
    });

    test("returns false when .overstory directory does not exist (non-zero exit code)", async () => {
      let callCount = 0;
      const mockExec = mock<() => Promise<ExecResult>>(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(mockResult("/home/user/my-repo\n"));
        }
        // ls returns non-zero when directory doesn't exist
        return Promise.resolve({ stdout: "", stderr: "No such file or directory", code: 2, killed: false });
      });

      const result = await isOverstoryRepo(mockExec);
      expect(result).toBe(false);
    });

    test("returns false when not in a git repo (git rev-parse throws)", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => {
        return Promise.reject(new Error("fatal: not a git repository"));
      });

      const result = await isOverstoryRepo(mockExec);
      expect(result).toBe(false);
    });

    test("returns false when ls command throws", async () => {
      let callCount = 0;
      const mockExec = mock<() => Promise<ExecResult>>(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(mockResult("/home/user/my-repo\n"));
        }
        return Promise.reject(new Error("ls failed"));
      });

      const result = await isOverstoryRepo(mockExec);
      expect(result).toBe(false);
    });

    test("trims whitespace from git root path", async () => {
      let callCount = 0;
      const mockExec = mock<() => Promise<ExecResult>>(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(mockResult("  /home/user/my-repo  \n"));
        }
        return Promise.resolve(mockResult("/home/user/my-repo/.overstory"));
      });

      await isOverstoryRepo(mockExec);
      expect(mockExec).toHaveBeenCalledWith("ls", ["-d", "/home/user/my-repo/.overstory"]);
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
      expect(options.deliverAs).toBe("followUp");
      expect(options.triggerTurn).toBe(true);
    });

    test("full session_compact flow", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("Compacted context")));
      const mockSendMessage = mock<() => void>(() => {});

      await handleSessionCompact(mockExec, mockSendMessage);

      expect(mockExec).toHaveBeenCalledWith("overstory", ["prime", "--agent", "coordinator", "--compact"]);
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });

    test("full session_shutdown flow", async () => {
      const mockExec = mock<() => Promise<ExecResult>>(() => Promise.resolve(mockResult("")));

      await handleSessionShutdown(mockExec);

      expect(mockExec).toHaveBeenCalledTimes(2);
      expect(mockExec).toHaveBeenCalledWith("overstory", ["log", "session-end", "--agent", "coordinator"]);
      expect(mockExec).toHaveBeenCalledWith("mulch", ["learn"]);
    });
  });
});
