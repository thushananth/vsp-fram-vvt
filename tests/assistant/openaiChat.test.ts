import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ask } from "../../src/lib/assistant/loop";
import { capToolResult, compactHistory, createOpenAIChat, MAX_TOOL_RESULT_CHARS, type Transport, type WireMessage } from "../../src/lib/assistant/openaiChat";
import { createAssistantTools, TOOL_DECLARATIONS } from "../../src/lib/assistant/tools";
import { systemInstruction } from "../../src/lib/assistant/loop";
import { at, DAY, karthiDay, karthiPayments, memorySource } from "./fixtures";

describe("OpenAI-style chat (Groq)", () => {
  it("runs the loop with tool_calls and role:tool replies", async () => {
    const seen: WireMessage[][] = [];
    const replies = [
      { content: "", toolCalls: [{ id: "call_1", name: "sales_summary", arguments: JSON.stringify({ from: DAY, to: DAY }) }] },
      { content: "Net sales were as shown.", toolCalls: [] },
    ];
    const transport: Transport = async ({ messages, tools }) => {
      seen.push(messages);
      assert.equal((tools[0] as { type: string }).type, "function");
      return replies.shift()!;
    };
    const tools = createAssistantTools({ source: memorySource({ bills: karthiDay(), payments: karthiPayments() }), now: () => at(DAY, "19:00") });
    const chat = createOpenAIChat({ transport, system: "sys", tools: TOOL_DECLARATIONS });
    const answer = await ask({ chat, tools, question: "Today's sales" });
    assert.equal(answer.text, "Net sales were as shown.");
    const second = seen[1];
    assert.equal(second[0].role, "system");
    const assistant = second[2] as Extract<WireMessage, { role: "assistant" }>;
    assert.equal(assistant.tool_calls![0].id, "call_1");
    const tool = second[3] as Extract<WireMessage, { role: "tool" }>;
    assert.equal(tool.tool_call_id, "call_1");
    assert.match(tool.content, /netSales/);
  });

  it("keeps only question and answer text from earlier questions", () => {
    const h: WireMessage[] = [];
    for (let i = 1; i <= 6; i++) {
      h.push({ role: "user", content: `q${i}` });
      h.push({ role: "assistant", content: null, tool_calls: [{ id: `c${i}`, type: "function", function: { name: "query", arguments: "{}" } }] });
      h.push({ role: "tool", tool_call_id: `c${i}`, content: "big result" });
      h.push({ role: "assistant", content: `a${i}` });
    }
    const c = compactHistory(h, 4);
    assert.deepEqual(c.map((m) => m.content), ["q3", "a3", "q4", "a4", "q5", "a5", "q6", "a6"]);
  });

  it("caps tool results and survives unreadable arguments", async () => {
    assert.ok(capToolResult({ rows: "x".repeat(20000) }).length < MAX_TOOL_RESULT_CHARS + 100);
    const transport: Transport = async () => ({ content: "", toolCalls: [{ id: "x", name: "query", arguments: "{not json" }] });
    const chat = createOpenAIChat({ transport, system: "s", tools: TOOL_DECLARATIONS });
    const reply = await chat.send([{ text: "hi" }]);
    assert.ok("__unreadable" in reply.calls[0].args);
  });

  it("fixed part of each request stays small (8,000 tokens a minute on the free plan)", () => {
    const chars = JSON.stringify(TOOL_DECLARATIONS).length + systemInstruction(at(DAY, "09:00")).length;
    // About 3.5 characters per token.
    assert.ok(chars / 3.5 < 2000, `about ${Math.round(chars / 3.5)} tokens`);
  });
});
