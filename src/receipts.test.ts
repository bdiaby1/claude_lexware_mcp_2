import assert from 'node:assert/strict';
import test from 'node:test';

import { receiptToCandidate } from './matching.js';
import { extractAmountWithCurrency, extractDate } from './receipts.js';

// Regression fixtures: real tl;dv (Stripe-style) invoice text layers broke the
// original regex set — English month-name dates and a leading (not trailing) €.
const EUR_INVOICE_TEXT =
	'Invoice\nInvoice number 216A6CB2-19958767\nDate of issue April 7, 2025\nDate due \tApril 7, 2025\n' +
	'tldx Solutions GmbH\n€34.51 due April 7, 2025\nPay online\nSubtotal \t€29.00\nTotal \t€34.51\nAmount due \t€34.51\n';

const USD_INVOICE_TEXT =
	'Invoice\nInvoice number 216A6CB2-56356747\nDate of issue July 16, 2026\nDate due \tJuly 16, 2026\n' +
	'tldx Solutions GmbH\n$39.00 USD due July 16, 2026\nPay online\nSubtotal \t$39.00\nTotal \t$39.00\nAmount due \t$39.00 USD\n';

test('extractDate parses an English month-name "Date of issue" label', () => {
	const date = extractDate(EUR_INVOICE_TEXT);
	assert.equal(date?.toISOString().slice(0, 10), '2025-04-07');
});

test('extractDate parses a later English month-name date too', () => {
	const date = extractDate(USD_INVOICE_TEXT);
	assert.equal(date?.toISOString().slice(0, 10), '2026-07-16');
});

test('extractAmountWithCurrency parses a leading (not trailing) € amount as EUR', () => {
	const result = extractAmountWithCurrency(EUR_INVOICE_TEXT);
	assert.equal(result?.amountCents, 3451);
	assert.equal(result?.currency, 'EUR');
});

test('extractAmountWithCurrency tags a $ amount as USD, not EUR', () => {
	const result = extractAmountWithCurrency(USD_INVOICE_TEXT);
	assert.equal(result?.amountCents, 3900);
	assert.equal(result?.currency, 'USD');
});

test('extractAmountWithCurrency returns null when no currency symbol is present', () => {
	assert.equal(extractAmountWithCurrency('Total 34.51, no currency symbol here'), null);
});

test('receiptToCandidate excludes non-EUR amounts from EUR matching', () => {
	const usdReceipt = { fileName: 'x.pdf', amountCents: 3900, currency: 'USD', date: new Date('2026-07-16'), text: '' };
	const candidate = receiptToCandidate(usdReceipt);
	assert.equal(candidate.amountCents, null);
});

test('receiptToCandidate keeps EUR amounts usable for matching', () => {
	const eurReceipt = { fileName: 'x.pdf', amountCents: 3451, currency: 'EUR', date: new Date('2025-04-07'), text: '' };
	const candidate = receiptToCandidate(eurReceipt);
	assert.equal(candidate.amountCents, 3451);
});
