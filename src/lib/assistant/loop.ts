import { longDay } from "./dates";
import type { AssistantTools, ToolOutcome } from "./tools";

/**
 * The function-calling loop, kept free of firebase/ai so tests can drive it
 * with a fake model: send the question, run whatever tools the model asks for
 * on the tablet, send the results back, repeat until Gemini answers in text.
 */

/** Most tool rounds for one question before giving up. */
export const MAX_ROUNDS = 6;

export interface FunctionCallLike {
  id?: string;
  name: string;
  args: object;
}

export type PartLike = { text: string } | { functionResponse: { id?: string; name: string; response: object } };

export interface ModelReply {
  text: string;
  calls: FunctionCallLike[];
}

/** One conversation with the model. It keeps its own history between sends. */
export interface ChatLike {
  send(parts: PartLike[]): Promise<ModelReply>;
}

export type AskEvent =
  | { type: "tool-start"; key: number; name: string; args: Record<string, unknown> }
  | { type: "tool-done"; key: number; outcome: ToolOutcome };

export interface Answer {
  /** The model's reply with codes swapped back to names. */
  text: string;
  /** The same, split so the screen can mark the names that were codes. */
  segments: { text: string; code?: string }[];
  outcomes: ToolOutcome[];
  rounds: number;
  /** True when the round limit was hit before a text answer. */
  gaveUp: boolean;
}

export function systemInstruction(nowMs: number): string {
  return [
    "You answer questions from the owner (an admin) of VSP Farm, a chicken farm shop in Sri Lanka, about the shop's own data: sales, bills, credit customers, payments, advance orders, products, profit and cashiers' cash.",
    `Today is ${longDay(nowMs)} (Sri Lanka time). Dates in tools are Sri Lanka days written yyyy-mm-dd. A week runs Monday to Sunday unless the owner says otherwise.`,
    "Money is Sri Lankan rupees: write it as Rs 12,500. Weights are kg.",
    "Use only what the tools return. Never guess, estimate or invent figures. If the tools can't answer, say so plainly and suggest the closest question they can answer.",
    "Never do arithmetic yourself, not even adding two numbers. Call aggregate, sales_summary or profit_summary for every total, count, average or difference, and quote their numbers.",
    "Bills and payments can be read at most 62 days per call, and one question can read a limited number of records. If a tool says the limit is reached, answer with what you have or ask the owner for a shorter period.",
    "Customers appear as codes like C7 and staff as codes like U2. Write only the code (never a name next to it); the screen turns codes into names. When the owner names someone, call find_person first. If several people match, ask which one and list their codes.",
    "For a cash shortage, use cash_check. Present its results as bills to check, never as proof that someone made a mistake or took money.",
    "The screen shows each tool's figures as cards next to your reply, so keep the reply short: two or three sentences with the key figures and what stands out. Don't repeat whole tables.",
    "You can only read. You can't change bills, send SMS or print. If asked to, say the owner can do it from the matching screen.",
    "Reply in the language of the question: English or Tamil.",
  ].join("\n");
}

export async function ask(params: {
  chat: ChatLike;
  tools: AssistantTools;
  question: string;
  onEvent?: (e: AskEvent) => void;
  signal?: AbortSignal;
  maxRounds?: number;
}): Promise<Answer> {
  const { chat, tools, onEvent, signal } = params;
  const maxRounds = params.maxRounds ?? MAX_ROUNDS;
  tools.beginQuestion();
  const outcomes: ToolOutcome[] = [];

  let reply = await chat.send([{ text: params.question }]);
  let rounds = 0;
  let callKey = 0;
  while (reply.calls.length > 0) {
    if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
    if (rounds >= maxRounds) {
      const text = "That question needed more steps than allowed. Try asking for one thing at a time.";
      return { text, segments: [{ text }], outcomes, rounds, gaveUp: true };
    }
    rounds += 1;
    // The model may ask for several tools at once; they only read, so run them together.
    const results = await Promise.all(
      reply.calls.map(async (call) => {
        const args = (call.args ?? {}) as Record<string, unknown>;
        const key = callKey++;
        onEvent?.({ type: "tool-start", key, name: call.name, args });
        const outcome = await tools.run(call.name, args);
        onEvent?.({ type: "tool-done", key, outcome });
        return { call, outcome };
      }),
    );
    outcomes.push(...results.map((r) => r.outcome));
    if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
    reply = await chat.send(
      results.map(({ call, outcome }) => ({
        functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response: outcome.forModel },
      })),
    );
  }

  const raw = reply.text.trim() || "I couldn't find an answer to that.";
  return { text: tools.masker.unmask(raw), segments: tools.masker.segments(raw), outcomes, rounds, gaveUp: false };
}
