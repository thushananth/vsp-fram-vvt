import type { ChatLike, ModelReply, PartLike } from "./loop";
import type { ToolDeclaration } from "./tools";

/**
 * A ChatLike over an OpenAI-style chat API (Groq). Pure: the actual call is a
 * `transport` passed in (the askAssistant Cloud Function in the app, a fake in
 * tests), so this folder still never calls a function itself.
 *
 * The service allows only so many tokens a minute, and every turn resends the
 * whole conversation, so the history is kept lean:
 * - earlier questions keep only their question and final answer, not the
 *   tool calls and results that led to it;
 * - only the last few exchanges are kept;
 * - each tool result is capped in size.
 */

export interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type WireMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: WireToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface TransportReply {
  content: string;
  toolCalls: { id: string; name: string; arguments: string }[];
}

export type Transport = (request: { messages: WireMessage[]; tools: unknown[] }) => Promise<TransportReply>;

/** Earlier exchanges (question + answer) kept for follow-ups. */
export const KEEP_EXCHANGES = 4;
/** Longest tool result sent back, in characters (about 1,500 tokens). */
export const MAX_TOOL_RESULT_CHARS = 5000;

export function toWireTools(declarations: ToolDeclaration[]): unknown[] {
  return declarations.map((d) => ({ type: "function", function: d }));
}

/** Drop the tool traffic of finished questions and all but the last few exchanges. */
export function compactHistory(history: WireMessage[], keep = KEEP_EXCHANGES): WireMessage[] {
  const plain = history.filter(
    (m) => m.role === "user" || (m.role === "assistant" && !m.tool_calls?.length && m.content),
  );
  // Start at the `keep`-th last question.
  const questions = plain.flatMap((m, i) => (m.role === "user" ? [i] : []));
  const start = questions.length > keep ? questions[questions.length - keep] : 0;
  return plain.slice(start);
}

export function capToolResult(result: object): string {
  const json = JSON.stringify(result);
  if (json.length <= MAX_TOOL_RESULT_CHARS) return json;
  return `${json.slice(0, MAX_TOOL_RESULT_CHARS)}… [cut short: ask for fewer rows or fields, or use aggregate]`;
}

function parseArgs(raw: string): object {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return { __unreadable: raw.slice(0, 200) };
  }
}

export function createOpenAIChat(params: {
  transport: Transport;
  system: string;
  tools: ToolDeclaration[];
}): ChatLike & { history(): WireMessage[] } {
  let history: WireMessage[] = [];
  const tools = toWireTools(params.tools);

  return {
    history: () => history,
    async send(parts: PartLike[]): Promise<ModelReply> {
      for (const part of parts) {
        if ("text" in part) {
          history = [...compactHistory(history), { role: "user", content: part.text }];
        } else {
          const r = part.functionResponse;
          history.push({ role: "tool", tool_call_id: r.id ?? r.name, content: capToolResult(r.response) });
        }
      }
      const reply = await params.transport({ messages: [{ role: "system", content: params.system }, ...history], tools });
      const calls = reply.toolCalls ?? [];
      history.push({
        role: "assistant",
        content: reply.content || null,
        ...(calls.length
          ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.arguments } })) }
          : {}),
      });
      return {
        text: calls.length ? "" : reply.content ?? "",
        calls: calls.map((c) => ({ id: c.id, name: c.name, args: parseArgs(c.arguments) })),
      };
    },
  };
}
