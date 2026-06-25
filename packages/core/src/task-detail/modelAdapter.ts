export type TaskModelAdapter = "claude" | "codex";

const CODEX_MODEL_PATTERNS = [/^gpt-/i, /^o\d/i, /^codex-/i];
const CLAUDE_MODEL_PATTERNS = [/^claude-/i];

export function inferAdapterFromModelId(
  modelId: string | null | undefined,
): TaskModelAdapter | undefined {
  if (!modelId) return undefined;
  const normalized = modelId.trim();
  if (!normalized) return undefined;

  if (CODEX_MODEL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "codex";
  }
  if (CLAUDE_MODEL_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "claude";
  }
  return undefined;
}
