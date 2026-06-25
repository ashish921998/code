import type { AgentSession } from "@posthog/shared";
import { describe, expect, it, vi } from "vitest";
import { SessionService, type SessionServiceDeps } from "./sessionService";

const TASK_ID = "task-1";
const RUN_ID = "run-1";
const REPO = "/repo";

const noopLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    taskRunId: RUN_ID,
    taskId: TASK_ID,
    taskTitle: "Task",
    channel: "agent-event:run-1",
    events: [],
    startedAt: Date.now(),
    status: "error",
    isPromptPending: false,
    isCompacting: false,
    pendingPermissions: new Map(),
    promptStartedAt: null,
    pausedDurationMs: 0,
    messageQueue: [],
    optimisticItems: [],
    initialPrompt: [{ type: "text", text: "do the thing" }],
    ...overrides,
  };
}

function createService(session?: AgentSession) {
  const sessions: Record<string, AgentSession> = {};
  if (session) sessions[session.taskRunId] = session;

  const store = {
    getSessions: () => sessions,
    getSessionByTaskId: (taskId: string) =>
      Object.values(sessions).find((s) => s.taskId === taskId),
    setSession: (s: AgentSession) => {
      sessions[s.taskRunId] = s;
    },
    updateSession: (taskRunId: string, updates: Partial<AgentSession>) => {
      const s = sessions[taskRunId];
      if (s) Object.assign(s, updates);
    },
    clearTailOptimisticItems: vi.fn(),
    appendOptimisticItem: vi.fn(),
    replaceOptimisticWithEvent: vi.fn(),
    clearMessageQueue: vi.fn(),
  };

  const deps = {
    store,
    log: noopLog,
    notifyPromptComplete: vi.fn(),
    notifyPermissionRequest: vi.fn(),
    getPersistedConfigOptions: () => undefined,
    setPersistedConfigOptions: vi.fn(),
    trpc: {
      agent: {
        onSessionIdleKilled: {
          subscribe: () => ({ unsubscribe: vi.fn() }),
        },
        cancel: {
          mutate: vi.fn().mockResolvedValue(undefined),
        },
        getPreviewConfigOptions: {
          query: vi.fn().mockResolvedValue([]),
        },
      },
    },
  } as unknown as SessionServiceDeps;

  const service = new SessionService(deps);

  // Replace the private helpers clearSessionError delegates to so the test can
  // assert the session-intent args in isolation, without standing up the full
  // agent.start/createTaskRun/subscribe chain inside createNewLocalSession.
  const createSpy = vi.fn().mockResolvedValue(undefined);
  const teardownSpy = vi.fn().mockResolvedValue(undefined);
  const authSpy = vi.fn().mockResolvedValue({
    apiHost: "https://us.posthog.com",
    projectId: 1,
    client: {},
  });
  // biome-ignore lint/suspicious/noExplicitAny: spy on private methods
  const anyService = service as any;
  anyService.createNewLocalSession = createSpy;
  anyService.teardownSession = teardownSpy;
  anyService.getAuthCredentials = authSpy;

  return { service, createSpy, teardownSpy, sessions };
}

describe("clearSessionError preserves session intent on retry", () => {
  it("forwards the caller overrides (adapter/model/executionMode/reasoningLevel)", async () => {
    const { service, createSpy } = createService(makeSession());

    await service.clearSessionError(TASK_ID, REPO, {
      adapter: "codex",
      model: "gpt-5.5",
      executionMode: "auto",
      reasoningLevel: "high",
    });

    expect(createSpy).toHaveBeenCalledTimes(1);
    // createNewLocalSession(taskId, taskTitle, repoPath, auth, initialPrompt,
    //   executionMode, adapter, model, reasoningLevel)
    const [, , , , , executionMode, adapter, model, reasoningLevel] =
      createSpy.mock.calls[0];
    expect(adapter).toBe("codex");
    expect(model).toBe("gpt-5.5");
    expect(executionMode).toBe("auto");
    expect(reasoningLevel).toBe("high");
  });

  it("recovers adapter/model/executionMode from a previously-live session when no overrides are given", async () => {
    const session = makeSession({
      status: "error",
      idleKilled: true,
      adapter: "codex",
      configOptions: [
        {
          id: "model",
          name: "Model",
          type: "select",
          currentValue: "gpt-5.5",
          options: [],
          category: "model",
        },
        {
          id: "mode",
          name: "Approval Preset",
          type: "select",
          currentValue: "auto",
          options: [],
          category: "mode",
        },
        {
          id: "reasoning_effort",
          name: "Reasoning Level",
          type: "select",
          currentValue: "high",
          options: [],
          category: "thought_level",
        },
      ],
    });
    const { service, createSpy } = createService(session);

    await service.clearSessionError(TASK_ID, REPO);

    expect(createSpy).toHaveBeenCalledTimes(1);
    const [, , , , , executionMode, adapter, model, reasoningLevel] =
      createSpy.mock.calls[0];
    expect(adapter).toBe("codex");
    expect(model).toBe("gpt-5.5");
    expect(executionMode).toBe("auto");
    expect(reasoningLevel).toBe("high");
  });

  it("keeps the retry placeholder when fresh session creation fails", async () => {
    const session = makeSession();
    const { service, createSpy, teardownSpy, sessions } =
      createService(session);
    createSpy.mockRejectedValueOnce(new Error("still broken"));

    await expect(service.clearSessionError(TASK_ID, REPO)).rejects.toThrow(
      "still broken",
    );

    expect(teardownSpy).not.toHaveBeenCalled();
    expect(sessions[RUN_ID]).toBe(session);
  });

  it("recovers a Codex placeholder with no explicit model as Codex default", async () => {
    const session = makeSession({
      adapter: "codex",
      configOptions: [],
    });
    const { service, createSpy } = createService(session);

    await service.clearSessionError(TASK_ID, REPO);

    expect(createSpy).toHaveBeenCalledTimes(1);
    const [, , , , , , adapter, model] = createSpy.mock.calls[0];
    expect(adapter).toBe("codex");
    expect(model).toBeUndefined();
  });
});
