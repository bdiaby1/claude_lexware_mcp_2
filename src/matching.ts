import type { BankTransaction } from './csv.js';
import type { ReceiptInfo } from './receipts.js';

export interface Candidate {
	amountCents: number | null;
	date: Date | null;
}

export interface MatchResult<T extends Candidate> {
	transaction: BankTransaction;
	match: T | null;
	/** Other candidates that matched on amount but fell outside the date tolerance, for manual review. */
	amountOnlyMatches: T[];
}

function daysBetween(a: Date, b: Date): number {
	return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Matches bank transactions to candidates (receipts or Lexware vouchers) by exact
 * EUR amount plus a date tolerance window. Ambiguous or missing matches are
 * surfaced explicitly rather than guessed — this feeds bookkeeping reconciliation,
 * where a wrong silent match is worse than an unmatched transaction.
 */
export function matchTransactions<T extends Candidate>(
	transactions: BankTransaction[],
	candidates: T[],
	dateToleranceDays = 3,
): MatchResult<T>[] {
	return transactions.map((transaction) => {
		const amountMatches = candidates.filter(
			(c) => c.amountCents !== null && Math.abs(c.amountCents) === Math.abs(transaction.amountCents),
		);

		const withinDate = amountMatches.filter(
			(c) => c.date !== null && daysBetween(c.date, transaction.date) <= dateToleranceDays,
		);

		if (withinDate.length === 1) {
			return { transaction, match: withinDate[0], amountOnlyMatches: [] };
		}

		// Zero or ambiguous (>1) date-matches: report as unmatched, keep amount-only
		// candidates visible for a human to disambiguate.
		return { transaction, match: null, amountOnlyMatches: amountMatches };
	});
}

export function receiptToCandidate(receipt: ReceiptInfo): Candidate & { receipt: ReceiptInfo } {
	// Bank transactions here are EUR-denominated; a foreign-currency receipt amount
	// (e.g. a USD invoice) must never be treated as an equal EUR amount, so exclude
	// it from amount matching entirely rather than comparing raw numbers across currencies.
	const eurAmountCents = receipt.currency === null || receipt.currency === 'EUR' ? receipt.amountCents : null;
	return { amountCents: eurAmountCents, date: receipt.date, receipt };
}
