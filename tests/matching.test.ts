import { describe, expect, it } from "vitest";
import { matchTransactions } from "../src/matching.js";
import type { BankTransaction } from "../src/csv.js";

function tx(dateIso: string, amountCents: number): BankTransaction {
  return { date: new Date(dateIso), amountCents, raw: {} };
}

describe("matchTransactions", () => {
  it("matches on exact amount within date tolerance", () => {
    const transactions = [tx("2026-01-05", 4200)];
    const candidates = [{ amountCents: 4200, date: new Date("2026-01-06"), id: "a" }];

    const [result] = matchTransactions(transactions, candidates, 3);
    expect(result.match?.id).toBe("a");
  });

  it("does not match when the date is outside tolerance", () => {
    const transactions = [tx("2026-01-05", 4200)];
    const candidates = [{ amountCents: 4200, date: new Date("2026-02-01"), id: "a" }];

    const [result] = matchTransactions(transactions, candidates, 3);
    expect(result.match).toBeNull();
    expect(result.amountOnlyMatches).toHaveLength(1);
  });

  it("does not match on sign, only magnitude (bank debit vs. voucher amount)", () => {
    const transactions = [tx("2026-01-05", -4200)];
    const candidates = [{ amountCents: 4200, date: new Date("2026-01-05"), id: "a" }];

    const [result] = matchTransactions(transactions, candidates, 3);
    expect(result.match?.id).toBe("a");
  });

  it("reports ambiguous matches (same amount, multiple candidates in window) as unmatched", () => {
    const transactions = [tx("2026-01-05", 4200)];
    const candidates = [
      { amountCents: 4200, date: new Date("2026-01-05"), id: "a" },
      { amountCents: 4200, date: new Date("2026-01-06"), id: "b" },
    ];

    const [result] = matchTransactions(transactions, candidates, 3);
    expect(result.match).toBeNull();
    expect(result.amountOnlyMatches).toHaveLength(2);
  });

  it("returns no match when no candidate has that amount", () => {
    const transactions = [tx("2026-01-05", 4200)];
    const candidates = [{ amountCents: 500, date: new Date("2026-01-05"), id: "a" }];

    const [result] = matchTransactions(transactions, candidates, 3);
    expect(result.match).toBeNull();
    expect(result.amountOnlyMatches).toHaveLength(0);
  });
});
