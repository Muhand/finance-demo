import { describe, expect, it } from "vitest";
import { AskRequestSchema } from "@finance-demo/contracts";

const QUESTION = "How is the gross margin trending?";

describe("AskRequestSchema normalisation", () => {
  it("trims and uppercases the ticker", () => {
    const parsed = AskRequestSchema.parse({ ticker: "  aapl \n", question: QUESTION });
    expect(parsed.ticker).toBe("AAPL");
  });

  it("trims the question but preserves its interior text verbatim", () => {
    const parsed = AskRequestSchema.parse({
      ticker: "msft",
      question: "   What   are  the   risks?  ",
    });
    expect(parsed.question).toBe("What   are  the   risks?");
  });

  it("uppercases mixed-case and hyphenated symbols", () => {
    expect(AskRequestSchema.parse({ ticker: "brk-b", question: QUESTION }).ticker).toBe("BRK-B");
  });
});

describe("AskRequestSchema validation", () => {
  it("rejects an empty or whitespace-only ticker", () => {
    for (const ticker of ["", "   ", "\t\n"]) {
      expect(AskRequestSchema.safeParse({ ticker, question: QUESTION }).success).toBe(false);
    }
  });

  it("rejects a ticker longer than 10 characters", () => {
    expect(AskRequestSchema.safeParse({ ticker: "A".repeat(11), question: QUESTION }).success).toBe(false);
    expect(AskRequestSchema.safeParse({ ticker: "A".repeat(10), question: QUESTION }).success).toBe(true);
  });

  it("rejects questions shorter than 3 characters, after trimming", () => {
    for (const question of ["", "  ", "hi", " a "]) {
      expect(AskRequestSchema.safeParse({ ticker: "AAPL", question }).success).toBe(false);
    }
    expect(AskRequestSchema.safeParse({ ticker: "AAPL", question: "why" }).success).toBe(true);
  });

  it("rejects questions longer than 2000 characters and accepts exactly 2000", () => {
    expect(AskRequestSchema.safeParse({ ticker: "AAPL", question: "q".repeat(2001) }).success).toBe(false);
    expect(AskRequestSchema.safeParse({ ticker: "AAPL", question: "q".repeat(2000) }).success).toBe(true);
  });

  it("counts length after trimming, so padding cannot smuggle an over-long question in", () => {
    const padded = `  ${"q".repeat(2000)}  `;
    const res = AskRequestSchema.safeParse({ ticker: "AAPL", question: padded });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.question).toHaveLength(2000);
  });

  it("rejects non-string and missing fields", () => {
    expect(AskRequestSchema.safeParse({ ticker: 123, question: QUESTION }).success).toBe(false);
    expect(AskRequestSchema.safeParse({ ticker: "AAPL" }).success).toBe(false);
    expect(AskRequestSchema.safeParse({ question: QUESTION }).success).toBe(false);
    expect(AskRequestSchema.safeParse(null).success).toBe(false);
    expect(AskRequestSchema.safeParse("AAPL").success).toBe(false);
  });
});
