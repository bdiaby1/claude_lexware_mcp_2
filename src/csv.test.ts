import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBankCsv, parseEuroAmountToCents, parseGermanOrIsoDate } from './csv.js';

test('parseEuroAmountToCents parses German decimal commas', () => {
	assert.equal(parseEuroAmountToCents('1.234,56'), 123456);
	assert.equal(parseEuroAmountToCents('42,00'), 4200);
});

test('parseEuroAmountToCents parses plain decimal points', () => {
	assert.equal(parseEuroAmountToCents('42.50'), 4250);
});

test('parseEuroAmountToCents parses negative amounts', () => {
	assert.equal(parseEuroAmountToCents('-42,00'), -4200);
});

test('parseEuroAmountToCents parses amounts with a EUR sign', () => {
	assert.equal(parseEuroAmountToCents('12,34 €'), 1234);
});

test('parseGermanOrIsoDate parses dd.mm.yyyy', () => {
	const d = parseGermanOrIsoDate('31.12.2025');
	assert.equal(d.toISOString().slice(0, 10), '2025-12-31');
});

test('parseGermanOrIsoDate parses ISO dates', () => {
	const d = parseGermanOrIsoDate('2025-12-31');
	assert.equal(d.toISOString().slice(0, 10), '2025-12-31');
});

test('parseBankCsv parses a typical German bank export', () => {
	const csv = 'Datum;Betrag;Verwendungszweck\n31.12.2025;-42,00;Buero Bedarf\n01.01.2026;100,00;Gutschrift\n';
	const transactions = parseBankCsv(csv);
	assert.equal(transactions.length, 2);
	assert.equal(transactions[0].amountCents, -4200);
	assert.equal(transactions[0].date.toISOString().slice(0, 10), '2025-12-31');
	assert.equal(transactions[1].amountCents, 10000);
});

test('parseBankCsv throws a helpful error when no known column matches', () => {
	const csv = 'Foo,Bar\n1,2\n';
	assert.throws(() => parseBankCsv(csv), /Could not find a matching column/);
});

test('parseBankCsv does not let German decimal commas in amounts break semicolon-delimited parsing', () => {
	// Regression: naive [',', ';'] auto-detection mis-split "13,39" into two fields.
	const csv = 'Datum;Betrag;Verwendungszweck\n26.07.2026;-13,39;Haufe Rechnung\n26.07.2026;-999,99;Kein Treffer\n';
	const transactions = parseBankCsv(csv);
	assert.equal(transactions.length, 2);
	assert.equal(transactions[0].amountCents, -1339);
	assert.equal(transactions[1].amountCents, -99999);
});

test('parseBankCsv parses comma-delimited CSV with plain decimal points', () => {
	const csv = 'Date,Amount\n2026-01-05,42.50\n';
	const transactions = parseBankCsv(csv);
	assert.equal(transactions.length, 1);
	assert.equal(transactions[0].amountCents, 4250);
});
