import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LexwareClient, type LexwareVoucher } from "./lexware/client.js";
import { parseBankCsv } from "./csv.js";
import { extractReceiptInfo } from "./receipts.js";
import { matchTransactions, receiptToCandidate } from "./matching.js";

function text(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

export function registerTools(server: McpServer, lexware: LexwareClient): void {
  server.registerTool(
    "lexware_list_vouchers",
    {
      description:
        "Lists Lexware Office vouchers (invoices, receipts, credit notes, ...). voucherType and " +
        "voucherStatus are required by the Lexware API itself.",
      inputSchema: {
        voucherType: z.string().describe("e.g. salesinvoice, purchaseinvoice, invoice, creditnote"),
        voucherStatus: z.string().describe("e.g. open, paid, voided, transferred, draft"),
        voucherDateFrom: z.string().optional().describe("ISO date, e.g. 2026-01-01"),
        voucherDateTo: z.string().optional().describe("ISO date, e.g. 2026-12-31"),
        page: z.number().int().min(0).optional(),
        size: z.number().int().min(1).max(250).optional(),
      },
    },
    async (args) => text(await lexware.listVouchers(args)),
  );

  server.registerTool(
    "lexware_get_voucher",
    {
      description: "Fetches a single Lexware Office voucher by id.",
      inputSchema: { id: z.string().describe("Lexware voucher UUID") },
    },
    async ({ id }) => text(await lexware.getVoucher(id)),
  );

  server.registerTool(
    "lexware_list_contacts",
    {
      description: "Lists Lexware Office contacts (customers/vendors).",
      inputSchema: { page: z.number().int().min(0).optional(), size: z.number().int().min(1).max(250).optional() },
    },
    async ({ page, size }) => text(await lexware.listContacts(page, size)),
  );

  server.registerTool(
    "match_bank_csv_to_vouchers",
    {
      description:
        "Parses a bank statement CSV (date + EUR amount columns) and matches each transaction against " +
        "open Lexware vouchers by exact amount and a date tolerance window. Fetches the voucher list itself.",
      inputSchema: {
        csvContent: z.string().describe("Raw CSV file content"),
        voucherType: z.string().describe("e.g. salesinvoice, purchaseinvoice, invoice, creditnote"),
        voucherStatus: z.string().optional().describe("Defaults to 'open'"),
        dateToleranceDays: z.number().int().min(0).max(60).optional().default(3),
      },
    },
    async ({ csvContent, voucherType, voucherStatus, dateToleranceDays }) => {
      const transactions = parseBankCsv(csvContent);
      if (transactions.length === 0) {
        return text({ matched: [], unmatched: [], note: "No transactions parsed from CSV." });
      }

      const dayMs = 24 * 60 * 60 * 1000;
      // Pad by the match tolerance (plus one day of slack for voucher-date/timezone
      // boundary effects observed on the Lexware side) so a voucher just outside the
      // transactions' own min/max date range isn't silently excluded from the search.
      const padMs = (dateToleranceDays + 1) * dayMs;
      const dates = transactions.map((t) => t.date.getTime());
      const voucherDateFrom = new Date(Math.min(...dates) - padMs).toISOString().slice(0, 10);
      const voucherDateTo = new Date(Math.max(...dates) + padMs).toISOString().slice(0, 10);

      const voucherFilters = { voucherType, voucherStatus: voucherStatus ?? "open", voucherDateFrom, voucherDateTo };
      const vouchers: LexwareVoucher[] = [];
      const maxPages = 40; // 40 * 250 = 10,000 vouchers, well beyond a manual reconciliation batch
      for (let pageNumber = 0; pageNumber < maxPages; pageNumber++) {
        const page = await lexware.listVouchers({ ...voucherFilters, page: pageNumber, size: 250 });
        vouchers.push(...page.content);
        if (pageNumber >= page.totalPages - 1) break;
      }

      const candidates = vouchers.map((v) => ({
        amountCents: Math.round(v.totalAmount * 100),
        date: new Date(v.voucherDate),
        voucher: v,
      }));

      const results = matchTransactions(transactions, candidates, dateToleranceDays);
      return text({
        matched: results.filter((r) => r.match).map((r) => ({ transaction: r.transaction.raw, voucher: r.match })),
        unmatched: results
          .filter((r) => !r.match)
          .map((r) => ({
            transaction: r.transaction.raw,
            amountOnlyCandidates: r.amountOnlyMatches.map((c) => c.voucher),
          })),
      });
    },
  );

  server.registerTool(
    "match_receipts_to_bank_csv",
    {
      description:
        "Matches receipt PDFs against a bank statement CSV (date + EUR amount) by extracting amount/date " +
        "from each PDF's text and comparing with exact-amount + date-tolerance matching. Extraction is a " +
        "best-effort regex heuristic — always review the 'unmatched' list, don't assume completeness.",
      inputSchema: {
        csvContent: z.string().describe("Raw CSV file content"),
        receipts: z
          .array(
            z.object({
              fileName: z.string(),
              contentBase64: z.string().describe("Base64-encoded PDF bytes"),
            }),
          )
          .min(1),
        dateToleranceDays: z.number().int().min(0).max(60).optional().default(3),
      },
    },
    async ({ csvContent, receipts, dateToleranceDays }) => {
      const transactions = parseBankCsv(csvContent);
      const receiptInfos = await Promise.all(
        receipts.map((r) => extractReceiptInfo(Buffer.from(r.contentBase64, "base64"), r.fileName)),
      );
      const candidates = receiptInfos.map(receiptToCandidate);
      const results = matchTransactions(transactions, candidates, dateToleranceDays);

      return text({
        matched: results
          .filter((r) => r.match)
          .map((r) => ({ transaction: r.transaction.raw, receipt: r.match?.receipt.fileName })),
        unmatched: results
          .filter((r) => !r.match)
          .map((r) => ({
            transaction: r.transaction.raw,
            amountOnlyCandidates: r.amountOnlyMatches.map((c) => c.receipt.fileName),
          })),
        extractionIssues: receiptInfos
          .filter((r) => r.amountCents === null || r.date === null)
          .map((r) => ({ fileName: r.fileName, amountFound: r.amountCents !== null, dateFound: r.date !== null })),
      });
    },
  );
}
