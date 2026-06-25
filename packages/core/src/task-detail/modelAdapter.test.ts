import { describe, expect, it } from "vitest";
import { inferAdapterFromModelId } from "./modelAdapter";

describe("inferAdapterFromModelId", () => {
  it.each(["gpt-5.5", "gpt-5.4", "o3", "o4-mini", "codex-mini"])(
    "maps OpenAI model %s to Codex",
    (model) => {
      expect(inferAdapterFromModelId(model)).toBe("codex");
    },
  );

  it.each(["claude-opus-4-8", "claude-sonnet-4-5"])(
    "maps Anthropic model %s to Claude",
    (model) => {
      expect(inferAdapterFromModelId(model)).toBe("claude");
    },
  );

  it.each([undefined, null, "", "fable", "custom-model"])(
    "leaves ambiguous model %s unchanged",
    (model) => {
      expect(inferAdapterFromModelId(model)).toBeUndefined();
    },
  );
});
