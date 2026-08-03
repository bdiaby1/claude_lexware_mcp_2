import { PDFParse } from 'pdf-parse';
import { parseEuroAmountToCents, parseGermanOrIsoDate } from './csv.js';

export interface ReceiptInfo {
	fileName: string;
	amountCents: number | null;
	/** ISO 4217-ish currency code the amount was found in (e.g. 'EUR', 'USD'), or null if no currency symbol was found near the amount. */
	currency: string | null;
	date: Date | null;
	text: string;
}

// \b before each label so e.g. "total" doesn't match inside "Subtotal". "amount due" is
// listed first since it's the most authoritative "what's actually owed" field when present.
const AMOUNT_LABELS = ['\\bamount due', '\\bgesamtbetrag', '\\bgesamt(?:summe)?', '\\btotal', '\\bbrutto'];

/**
 * Finds an amount plus its currency. The currency symbol must be present (not optional) —
 * matching a bare number without a symbol risks silently treating a foreign-currency amount
 * as EUR, which would produce a financially wrong match.
 */
export function extractAmountWithCurrency(text: string): { amountCents: number; currency: string } | null {
	const tryParse = (raw: string, currency: string) => {
		try {
			return { amountCents: parseEuroAmountToCents(raw), currency };
		} catch {
			return null;
		}
	};

	for (const label of AMOUNT_LABELS) {
		let match = text.match(new RegExp(`${label}[:\\s]*€\\s*([\\d.,]+)`, 'i'));
		if (match) {
			const parsed = tryParse(match[1], 'EUR');
			if (parsed) return parsed;
		}
		match = text.match(new RegExp(`${label}[:\\s]*([\\d.,]+)\\s*€`, 'i'));
		if (match) {
			const parsed = tryParse(match[1], 'EUR');
			if (parsed) return parsed;
		}
		match = text.match(new RegExp(`${label}[:\\s]*\\$\\s*([\\d.,]+)`, 'i'));
		if (match) {
			const parsed = tryParse(match[1], 'USD');
			if (parsed) return parsed;
		}
	}

	const bareEur = text.match(/€\s*([\d.,]+)/) ?? text.match(/([\d.,]+)\s*€/);
	if (bareEur) {
		const parsed = tryParse(bareEur[1], 'EUR');
		if (parsed) return parsed;
	}

	const bareUsd = text.match(/\$\s*([\d.,]+)/);
	if (bareUsd) {
		const parsed = tryParse(bareUsd[1], 'USD');
		if (parsed) return parsed;
	}

	return null;
}

const MONTH_NAMES = [
	'january', 'february', 'march', 'april', 'may', 'june',
	'july', 'august', 'september', 'october', 'november', 'december',
];

function parseDateToken(raw: string): Date | null {
	const isoOrDmy = raw.match(/^(\d{4}-\d{2}-\d{2})$/) ?? raw.match(/^(\d{1,2}[./]\d{1,2}[./]\d{4})$/);
	if (isoOrDmy) {
		try {
			return parseGermanOrIsoDate(isoOrDmy[1]);
		} catch {
			return null;
		}
	}

	const monthName = raw.match(
		/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})$/i,
	);
	if (monthName) {
		const monthIndex = MONTH_NAMES.indexOf(monthName[1].toLowerCase());
		return new Date(Date.UTC(Number(monthName[3]), monthIndex, Number(monthName[2])));
	}

	return null;
}

const DATE_TOKEN_PATTERNS = [
	/\b(\d{4}-\d{2}-\d{2})\b/,
	/\b(\d{1,2}[./]\d{1,2}[./]\d{4})\b/,
	/\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\b/i,
];

function findFirstDate(text: string): Date | null {
	for (const pattern of DATE_TOKEN_PATTERNS) {
		const match = text.match(pattern);
		if (match) {
			const parsed = parseDateToken(match[1]);
			if (parsed) return parsed;
		}
	}
	return null;
}

export function extractDate(text: string): Date | null {
	// Prefer a labeled issue date over the first bare date match — a receipt's body
	// (billing address, period range, ...) can contain other unrelated dates/numbers.
	const issueLabelMatch = text.match(/date of issue[:\s]*([^\n]+)/i);
	if (issueLabelMatch) {
		const fromLabel = findFirstDate(issueLabelMatch[1]);
		if (fromLabel) return fromLabel;
	}
	return findFirstDate(text);
}

/**
 * Best-effort extraction of amount + date from a receipt PDF's text layer.
 * Heuristic (regex over free text), not a guarantee — always surface unmatched
 * receipts to a human rather than silently dropping them.
 */
export async function extractReceiptInfo(buffer: Buffer, fileName: string): Promise<ReceiptInfo> {
	const parser = new PDFParse({ data: buffer });
	try {
		const { text } = await parser.getText();
		const amount = extractAmountWithCurrency(text);
		return {
			fileName,
			amountCents: amount?.amountCents ?? null,
			currency: amount?.currency ?? null,
			date: extractDate(text),
			text,
		};
	} finally {
		await parser.destroy();
	}
}
