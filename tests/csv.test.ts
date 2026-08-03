import { describe, expect, it } from "vitest";
import { parseBankCsv, parseEuroAmountToCents, parseGermanOrIsoDate } from "../src/csv.js";

describe("parseEuroAmountToCents", () => {
  it("parses German decimal comma", () => {
    expect(parseEuroAmountToCents("1.234,56")).toBe(123456);
    expect(parseEuroAmountToCents("42,00")).toBe(4200);
  });

  it("parses plain decimal point", () => {
    expect(parseEuroAmountToCents("42.50")).toBe(4250);
  });

  it("parses negative amounts", () => {
    expect(parseEuroAmountToCents("-42,00")).toBe(-4200);
  });

  it("parses amounts with an EUR sign", () => {
    expect(parseEuroAmountToCents("12,34 €")).toBe(1234);
  });
});

describe("parseGermanOrIsoDate", () => {
  it("parses dd.mm.yyyy", () => {
    const d = parseGermanOrIsoDate("31.12.2025");
    expect(d.toISOString().slice(0, 10)).toBe("2025-12-31");
  });

  it("parses iso dates", () => {
    const d = parseGermanOrIsoDate("2025-12-31");
    expect(d.toISOString().slice(0, 10)).toBe("2025-12-31");
  });
});

describe("parseBankCsv", () => {
  it("parses a typical German bank export", () => {
    const csv = "Datum;Betrag;Verwendungszweck\n31.12.2025;-42,00;Buero Bedarf\n01.01.2026;100,00;Gutschrift\n";
    const transactions = parseBankCsv(csv);
    expect(transactions).toHaveLength(2);
    expect(transactions[0].amountCents).toBe(-4200);
    expect(transactions[0].date.toISOString().slice(0, 10)).toBe("2025-12-31");
    expect(transactions[1].amountCents).toBe(10000);
  });

  it("throws a helpful error when no known column matches", () => {
    const csv = "Foo,Bar\n1,2\n";
    expect(() => parseBankCsv(csv)).toThrow(/Could not find a matching column/);
  });
});
