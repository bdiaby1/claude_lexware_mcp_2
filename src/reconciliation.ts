import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { parseBankCsv } from './csv.js';
import type { LexwareApiClient } from './lexware-client.js';
import { matchTransactions, receiptToCandidate } from './matching.js';
import { extractReceiptInfo } from './receipts.js';
import { stringifyForMcp } from './truncate.js';

interface LexwareVoucher {
	id: string;
	voucherType: string;
	voucherStatus: string;
	voucherDate: string;
	totalAmount: number;
	[key: string]: unknown;
}

interface VoucherListPage {
	content: LexwareVoucher[];
	totalPages: number;
}

function toolResult(payload: unknown, isError = false) {
	return { content: [{ type: 'text' as const, text: stringifyForMcp(payload) }], isError };
}

/**
 * Fetches every voucher matching the given filters within a padded date range,
 * paging through the Lexware /voucherlist endpoint. voucherType and voucherStatus
 * are mandatory query params on that endpoint (the API 400s without them).
 */
async function fetchVouchers(
	lexwareClient: LexwareApiClient,
	filters: { voucherType: string; voucherStatus: string; voucherDateFrom: string; voucherDateTo: string },
): Promise<LexwareVoucher[]> {
	const vouchers: LexwareVoucher[] = [];
	const maxPages = 40; // 40 * 250 = 10,000 vouchers, well beyond a manual reconciliation batch
	for (let page = 0; page < maxPages; page++) {
		const response = await lexwareClient.request({
			method: 'GET',
			path: '/v1/voucherlist',
			query: { ...filters, page, size: 250 },
		});

		if (!response.ok) {
			throw new Error(`Lexware /voucherlist request failed (${response.status}): ${JSON.stringify(response.data ?? response.text)}`);
		}

		const data = response.data as VoucherListPage;
		vouchers.push(...data.content);
		if (page >= data.totalPages - 1) break;
	}
	return vouchers;
}

export function registerReconciliationTools(server: McpServer, lexwareClient: LexwareApiClient): void {
	server.tool(
		'match_bank_csv_to_vouchers',
		'Parses a bank statement CSV (date + EUR amount columns) and matches each transaction against ' +
			'Lexware vouchers by exact amount and a date-tolerance window. Fetches the voucher list itself ' +
			'(paginated, date-range padded by the tolerance). Narrow voucherType/voucherStatus (comma-separated, ' +
			'e.g. "purchaseinvoice" + "open,paid") when reconciling a specific category — the underlying ' +
			'/voucherlist endpoint refuses to traverse beyond 10,000 matching entries, so split by date range ' +
			'or narrow the filters if that happens.',
		{
			csvContent: z.string().describe('Raw bank statement CSV content'),
			voucherType: z
				.string()
				.optional()
				.describe('Comma-separated types (e.g. salesinvoice, purchaseinvoice, invoice, creditnote) or the wildcard "any". Defaults to "any".'),
			voucherStatus: z
				.string()
				.optional()
				.describe('Comma-separated statuses (e.g. open, paid, voided, transferred, draft) or the wildcard "any". Defaults to "any".'),
			dateToleranceDays: z.number().int().min(0).max(60).optional().default(3),
		},
		async ({ csvContent, voucherType, voucherStatus, dateToleranceDays }) => {
			try {
				const transactions = parseBankCsv(csvContent);
				if (transactions.length === 0) {
					return toolResult({ matched: [], unmatched: [], note: 'No transactions parsed from CSV.' });
				}

				const dayMs = 24 * 60 * 60 * 1000;
				// Pad by the match tolerance (+1 day slack for a voucher-date/timezone boundary
				// effect observed against the real API) so a voucher just outside the transactions'
				// own min/max date isn't silently excluded from the search.
				const padMs = (dateToleranceDays + 1) * dayMs;
				const dates = transactions.map((t) => t.date.getTime());
				const voucherDateFrom = new Date(Math.min(...dates) - padMs).toISOString().slice(0, 10);
				const voucherDateTo = new Date(Math.max(...dates) + padMs).toISOString().slice(0, 10);

				const vouchers = await fetchVouchers(lexwareClient, {
					voucherType: voucherType ?? 'any',
					voucherStatus: voucherStatus ?? 'any',
					voucherDateFrom,
					voucherDateTo,
				});

				const candidates = vouchers.map((v) => ({
					amountCents: Math.round(v.totalAmount * 100),
					date: new Date(v.voucherDate),
					voucher: v,
				}));

				const results = matchTransactions(transactions, candidates, dateToleranceDays);
				return toolResult({
					matched: results.filter((r) => r.match).map((r) => ({ transaction: r.transaction.raw, voucher: r.match })),
					unmatched: results
						.filter((r) => !r.match)
						.map((r) => ({
							transaction: r.transaction.raw,
							amountOnlyCandidates: r.amountOnlyMatches.map((c) => c.voucher),
						})),
				});
			} catch (error) {
				return toolResult({ error: error instanceof Error ? error.message : String(error) }, true);
			}
		},
	);

	server.tool(
		'match_receipts_to_bank_csv',
		'Matches receipt PDFs against a bank statement CSV (date + EUR amount) by extracting amount/date ' +
			"from each PDF's text and comparing with exact-amount + date-tolerance matching. Extraction is a " +
			"best-effort regex heuristic — always review the 'unmatched' and 'extractionIssues' lists, don't " +
			'assume completeness (no OCR: receipts that are pure scanned images without a text layer will not extract).',
		{
			csvContent: z.string().describe('Raw bank statement CSV content'),
			receipts: z
				.array(z.object({ fileName: z.string(), contentBase64: z.string().describe('Base64-encoded PDF bytes') }))
				.min(1),
			dateToleranceDays: z.number().int().min(0).max(60).optional().default(3),
		},
		async ({ csvContent, receipts, dateToleranceDays }) => {
			try {
				const transactions = parseBankCsv(csvContent);
				const receiptInfos = await Promise.all(
					receipts.map((r) => extractReceiptInfo(Buffer.from(r.contentBase64, 'base64'), r.fileName)),
				);
				const candidates = receiptInfos.map(receiptToCandidate);
				const results = matchTransactions(transactions, candidates, dateToleranceDays);

				return toolResult({
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
						.filter((r) => r.amountCents === null || r.date === null || (r.currency !== null && r.currency !== 'EUR'))
						.map((r) => ({
							fileName: r.fileName,
							amountFound: r.amountCents !== null,
							currency: r.currency,
							dateFound: r.date !== null,
							note: r.currency !== null && r.currency !== 'EUR' ? `Amount is in ${r.currency}, not EUR — excluded from matching, not a real EUR bank amount.` : undefined,
						})),
				});
			} catch (error) {
				return toolResult({ error: error instanceof Error ? error.message : String(error) }, true);
			}
		},
	);
}
