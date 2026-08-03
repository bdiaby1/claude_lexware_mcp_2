import { PDFParse } from 'pdf-parse';
import { parseEuroAmountToCents, parseGermanOrIsoDate } from './csv.js';

export interface ReceiptInfo {
	fileName: string;
	amountCents: number | null;
	date: Date | null;
	text: string;
}

const AMOUNT_PATTERNS = [
	/gesamtbetrag[:\s]*€?\s*([\d.,]+)\s*€?/i,
	/gesamt(?:summe)?[:\s]*€?\s*([\d.,]+)\s*€?/i,
	/total[:\s]*€?\s*([\d.,]+)\s*€?/i,
	/brutto[:\s]*€?\s*([\d.,]+)\s*€?/i,
	/([\d.,]+)\s*€/,
];

const DATE_PATTERNS = [/\b(\d{1,2}[./]\d{1,2}[./]\d{4})\b/, /\b(\d{4}-\d{2}-\d{2})\b/];

function extractAmountCents(text: string): number | null {
	for (const pattern of AMOUNT_PATTERNS) {
		const match = text.match(pattern);
		if (match) {
			try {
				return parseEuroAmountToCents(match[1]);
			} catch {
				continue;
			}
		}
	}
	return null;
}

function extractDate(text: string): Date | null {
	for (const pattern of DATE_PATTERNS) {
		const match = text.match(pattern);
		if (match) {
			try {
				return parseGermanOrIsoDate(match[1]);
			} catch {
				continue;
			}
		}
	}
	return null;
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
		return {
			fileName,
			amountCents: extractAmountCents(text),
			date: extractDate(text),
			text,
		};
	} finally {
		await parser.destroy();
	}
}
