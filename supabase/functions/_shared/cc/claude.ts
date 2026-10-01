// Claude tool loop shared by cc-chat and cc-nightly.

import { runTool, type Ctx } from "./tools.ts";

export const CC_MODEL = Deno.env.get("CC_MODEL") ?? "claude-sonnet-5-5";
const API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MAX_TOOL_ROUNDS = 12;

export function ccConfigured(): boolean {
  return Boolean(API_KEY);
}

// ---------------------------------------------------------------------------
// Claude tool loop
// ---------------------------------------------------------------------------
type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

export async function runConversation(
  ctx: Ctx,
  system: string,
  history: { role: "user" | "assistant"; content: string }[],
  tools: unknown[],
  maxTokens = 1500,
) {
  // deno-lint-ignore no-explicit-any
  const messages: any[] = history.map((m) => ({ role: m.role, content: m.content }));
  let inputTokens = 0, outputTokens = 0, toolCalls = 0;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CC_MODEL,
        max_tokens: maxTokens,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        tools,
        messages,
      }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
    inputTokens += j.usage?.input_tokens ?? 0;
    outputTokens += j.usage?.output_tokens ?? 0;

    const content = (j.content ?? []) as Block[];
    const uses = content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");

    if (j.stop_reason !== "tool_use" || !uses.length || round === MAX_TOOL_ROUNDS) {
      const text = content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();
      return { text: text || "Sorry, I couldn't put an answer together. Please try rephrasing.", inputTokens, outputTokens, toolCalls };
    }

    messages.push({ role: "assistant", content });
    const results = [];
    for (const u of uses) {
      toolCalls++;
      let out: unknown;
      try {
        out = await runTool(ctx, u.name, u.input);
      } catch (e) {
        out = { error: e instanceof Error ? e.message : String(e) };
      }
      results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out).slice(0, 20000) });
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error("unreachable");
}

