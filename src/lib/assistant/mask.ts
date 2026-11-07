/**
 * Customer and staff names go to the model as codes: C7 for a customer, U2 for a
 * staff member. One table per chat, so C7 means the same shop in every answer
 * of that chat. It never leaves the tablet, and "New chat" or leaving the page
 * throws it away.
 *
 * A customer saved from the walk-in prompt with no name has their mobile
 * number as their name, which is one more reason every name is masked.
 */
export type PersonKind = "C" | "U";

interface Entry {
  kind: PersonKind;
  id: string;
  name: string;
}

const CODE = /\b([CU])(\d{1,5})\b/g;

export class Masker {
  private codes = new Map<string, string>();
  private entries = new Map<string, Entry>();
  private next: Record<PersonKind, number> = { C: 1, U: 1 };

  /** The code for this person, made on first sight. */
  code(kind: PersonKind, id: string, name: string): string {
    const key = `${kind}:${id}`;
    const existing = this.codes.get(key);
    if (existing) {
      // A later read may carry a better name (a cashier first seen on a bill).
      const entry = this.entries.get(existing)!;
      if (name && entry.name !== name && entry.name.startsWith("Unknown")) entry.name = name;
      return existing;
    }
    const code = `${kind}${this.next[kind]++}`;
    this.codes.set(key, code);
    this.entries.set(code, { kind, id, name: name || (kind === "C" ? "Unknown customer" : "Unknown user") });
    return code;
  }

  /** null in, null out: walk-in bills have no customer. */
  maybe(kind: PersonKind, id: string | null | undefined, name: string | null | undefined): string | null {
    return id ? this.code(kind, id, name ?? "") : null;
  }

  /** The document id behind a code, when the code is of the asked kind. */
  idOf(code: unknown, kind: PersonKind): string | undefined {
    if (typeof code !== "string") return undefined;
    const entry = this.entries.get(code.trim().toUpperCase());
    return entry && entry.kind === kind ? entry.id : undefined;
  }

  nameOf(code: string): string | undefined {
    return this.entries.get(code)?.name;
  }

  /** Swap every known code in the model's text back to the real name. */
  unmask(text: string): string {
    return text.replace(CODE, (whole) => this.entries.get(whole)?.name ?? whole);
  }

  /**
   * The text split into plain parts and names, so the screen can mark names
   * that came back from codes (the dotted underline in the design).
   */
  segments(text: string): { text: string; code?: string }[] {
    const out: { text: string; code?: string }[] = [];
    let last = 0;
    for (const m of text.matchAll(CODE)) {
      const entry = this.entries.get(m[0]);
      if (!entry) continue;
      if (m.index! > last) out.push({ text: text.slice(last, m.index) });
      out.push({ text: entry.name, code: m[0] });
      last = m.index! + m[0].length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  }

  clear(): void {
    this.codes.clear();
    this.entries.clear();
    this.next = { C: 1, U: 1 };
  }
}
