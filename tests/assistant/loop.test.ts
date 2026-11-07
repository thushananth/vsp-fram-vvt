import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ask, systemInstruction, type ChatLike, type ModelReply, type PartLike } from "../../src/lib/assistant/loop";
import { createAssistantTools } from "../../src/lib/assistant/tools";
import { at, DAY, karthiDay, karthiPayments, memorySource } from "./fixtures";

/**
 * A scripted stand-in for Gemini. Each step sees what the app sent and returns
 * the next reply, so tests check the loop without using the quota.
 */
function fakeChat(steps: ((sent: PartLike[]) => ModelReply)[]): ChatLike & { sent: PartLike[][] } {
  const sent: PartLike[][] = [];
  return {
    sent,
    async send(parts) {
      sent.push(parts);
      const step = steps.shift();
      if (!step) throw new Error("fake model ran out of replies");
      return step(parts);
    },
  };
}

function tools() {
  return createAssistantTools({
    source: memorySource({ bills: karthiDay(), payments: karthiPayments() }),
    now: () => at(DAY, "19:00"),
  });
}

describe("function-calling loop", () => {
  it("runs a cash check end to end and unmasks the answer", async () => {
    const t = tools();
    const chat = fakeChat([
      () => ({ text: "", calls: [{ name: "find_person", args: { name: "Karthi", kind: "staff" } }] }),
      (sent) => {
        const res = (sent[0] as { functionResponse: { response: { matches: { code: string }[] } } }).functionResponse.response;
        return { text: "", calls: [{ id: "c2", name: "cash_check", args: { date: DAY, cashier: res.matches[0].code, shortBy: 2500 } }] };
      },
      (sent) => {
        const r = (sent[0] as { functionResponse: { id?: string; response: { cashier: string; billsToCheck: { bills: string[] }[] } } }).functionResponse;
        assert.equal(r.id, "c2", "the call id goes back with its response");
        return { text: `${r.response.cashier} has ${r.response.billsToCheck.length} bills to check; start with ${r.response.billsToCheck[0].bills[0]}.`, calls: [] };
      },
    ]);
    const events: string[] = [];
    const answer = await ask({ chat, tools: t, question: "Karthi is Rs 2,500 short today", onEvent: (e) => events.push(e.type) });
    assert.equal(answer.rounds, 2);
    assert.equal(answer.gaveUp, false);
    assert.match(answer.text, /^Karthi has \d+ bills to check/);
    assert.ok(answer.segments.some((s) => s.code && s.text === "Karthi"));
    assert.deepEqual(events, ["tool-start", "tool-done", "tool-start", "tool-done"]);
    assert.equal(answer.outcomes.at(-1)!.forScreen!.type, "cash");
    assert.deepEqual(chat.sent[0], [{ text: "Karthi is Rs 2,500 short today" }]);
  });

  it("runs parallel calls together and passes tool errors back for Gemini to fix", async () => {
    const t = tools();
    const chat = fakeChat([
      () => ({
        text: "",
        calls: [
          { name: "sales_summary", args: { from: "2026-11-01", to: DAY } },
          { name: "query", args: { collection: "bills" } },
        ],
      }),
      (sent) => {
        assert.equal(sent.length, 2);
        const err = (sent[1] as { functionResponse: { response: { error?: string } } }).functionResponse.response.error;
        assert.match(String(err), /needs from and to/);
        return { text: "Sales are shown below.", calls: [] };
      },
    ]);
    const answer = await ask({ chat, tools: t, question: "This week" });
    assert.equal(answer.outcomes.length, 2);
    assert.equal(answer.outcomes[1].ok, false);
  });

  it("gives up after the round limit", async () => {
    const t = tools();
    const loopForever = () => ({ text: "", calls: [{ name: "query", args: { collection: "products" } }] });
    const chat = fakeChat(Array.from({ length: 10 }, () => loopForever));
    const answer = await ask({ chat, tools: t, question: "?", maxRounds: 3 });
    assert.equal(answer.gaveUp, true);
    assert.equal(answer.rounds, 3);
  });

  it("system instruction carries today's date and the rules", () => {
    const s = systemInstruction(at(DAY, "09:00"));
    assert.match(s, /Saturday 7 November 2026/);
    assert.match(s, /Never do arithmetic yourself/);
    assert.match(s, /bills to check/);
    assert.match(s, /English or Tamil/);
  });
});
