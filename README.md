# Rana Lexware MCP Server

MCP server that exposes Lexware Office (formerly lexoffice) data as tools, plus
reconciliation helpers for matching a bank statement CSV (EUR amount + date)
against Lexware vouchers or scanned receipt PDFs.

## Setup

```bash
npm install
cp .env.example .env   # fill in MCP_AUTH_TOKEN and LEXWARE_API_KEY
npm run build
npm start               # or `npm run dev` for a TS dev run without building
```

The server listens on `PORT` (default `8080`) and exposes MCP over streamable
HTTP at `POST /mcp`, authenticated via `Authorization: Bearer <MCP_AUTH_TOKEN>`.

Get a Lexware Office API key from your Lexware Office account under
Settings → API-Zugang (developers.lexware.io covers scopes/rate limits).

## Tools

| Tool | Description |
|---|---|
| `lexware_list_vouchers` | Lists vouchers (invoices, receipts, credit notes). `voucherType` and `voucherStatus` are required by the Lexware API itself; date range is optional. |
| `lexware_get_voucher` | Fetches a single voucher by id. |
| `lexware_list_contacts` | Lists contacts (customers/vendors). |
| `match_bank_csv_to_vouchers` | Parses a bank CSV and matches transactions against open Lexware vouchers by exact EUR amount + a date tolerance window. |
| `match_receipts_to_bank_csv` | Extracts amount/date from receipt PDFs (base64) and matches them against a bank CSV the same way. |

### Matching logic

Matching is amount-first: a transaction only matches a candidate (voucher or
receipt) with the **exact same EUR amount** (sign-insensitive — bank exports
show debits as negative, voucher/receipt totals as positive). Among amount
matches, only one falling inside `dateToleranceDays` (default 3, configurable
per call) counts as a match. Zero or more-than-one date-window matches are
reported as `unmatched`, with the amount-only candidates listed for manual
review — the tool never guesses on ambiguous data, since a wrong silent match
in bookkeeping reconciliation is worse than an unmatched transaction.

Receipt PDF extraction is a best-effort regex over the PDF's text layer
(looks for "Gesamtbetrag/Gesamt/Total/Brutto: X,XX €" and dd.mm.yyyy /
yyyy-mm-dd dates). It will not work on receipts that are pure scanned images
without a text layer (no OCR is performed) — check the `extractionIssues`
field in the tool result and review those manually.

### Bank CSV format

Auto-detects common column names: `Datum`/`Date`/`Buchungstag` for the date
and `Betrag`/`Amount`/`Umsatz` for the EUR amount (German `1.234,56` and plain
`1234.56` decimal formats both work). Pass `dateColumn`/`amountColumn`
explicitly if your export uses different headers.

## Using it as an MCP server (e.g. from Claude Code)

Add to your MCP config (e.g. `~/.claude.json`):

```json
{
  "mcpServers": {
    "rana-lexware": {
      "type": "http",
      "url": "http://localhost:8080/mcp",
      "headers": { "Authorization": "Bearer <MCP_AUTH_TOKEN>" }
    }
  }
}
```

## Network requirement

This server calls `api.lexware.io` directly — it needs outbound HTTPS access
to that host from wherever it runs. If you run it inside a sandboxed dev
environment with a restrictive egress policy, make sure that host is
reachable (or run it on your own machine/server instead).

## Tests

```bash
npm test
```

All tests are self-contained (mocked `fetch` for the Lexware client, no
network calls) so they run without a real API key.
