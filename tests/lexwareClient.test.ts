import { describe, expect, it, vi } from "vitest";
import { LexwareApiError, LexwareClient } from "../src/lexware/client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("LexwareClient", () => {
  it("sends a bearer token and builds voucherlist query params", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ content: [], totalElements: 0, totalPages: 0, number: 0 }));
    const client = new LexwareClient({ apiKey: "secret-key", baseUrl: "https://api.lexware.io/v1", fetchImpl });

    await client.listVouchers({ voucherType: "purchaseinvoice", voucherStatus: "open" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("https://api.lexware.io/v1/voucherlist?");
    expect(url).toContain("voucherType=purchaseinvoice");
    expect(url).toContain("voucherStatus=open");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
  });

  it("throws LexwareApiError with status and body on a non-2xx response", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("Host not in allowlist: api.lexware.io.", { status: 403 }),
    );
    const client = new LexwareClient({ apiKey: "secret-key", fetchImpl });

    await expect(client.getVoucher("abc")).rejects.toThrow(LexwareApiError);
    await expect(client.getVoucher("abc")).rejects.toThrow(/403/);
  });

  it("defaults to the Lexware Office production base URL", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ content: [], totalElements: 0 }));
    const client = new LexwareClient({ apiKey: "k", fetchImpl });

    await client.listContacts();

    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith("https://api.lexware.io/v1/contacts")).toBe(true);
  });
});
