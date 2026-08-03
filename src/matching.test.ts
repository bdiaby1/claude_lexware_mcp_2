import assert from 'node:assert/strict';
import test from 'node:test';

import type { BankTransaction } from './csv.js';
import { matchTransactions } from './matching.js';

function tx(dateIso: string, amountCents: number): BankTransaction {
	return { date: new Date(dateIso), amountCents, raw: {} };
}

test('matchTransactions matches on exact amount within date tolerance', () => {
	const transactions = [tx('2026-01-05', 4200)];
	const candidates = [{ amountCents: 4200, date: new Date('2026-01-06'), id: 'a' }];

	const [result] = matchTransactions(transactions, candidates, 3);
	assert.equal(result.match?.id, 'a');
});

test('matchTransactions does not match when the date is outside tolerance', () => {
	const transactions = [tx('2026-01-05', 4200)];
	const candidates = [{ amountCents: 4200, date: new Date('2026-02-01'), id: 'a' }];

	const [result] = matchTransactions(transactions, candidates, 3);
	assert.equal(result.match, null);
	assert.equal(result.amountOnlyMatches.length, 1);
});

test('matchTransactions matches on magnitude only, ignoring sign (bank debit vs. voucher amount)', () => {
	const transactions = [tx('2026-01-05', -4200)];
	const candidates = [{ amountCents: 4200, date: new Date('2026-01-05'), id: 'a' }];

	const [result] = matchTransactions(transactions, candidates, 3);
	assert.equal(result.match?.id, 'a');
});

test('matchTransactions reports ambiguous matches (same amount, multiple candidates in window) as unmatched', () => {
	const transactions = [tx('2026-01-05', 4200)];
	const candidates = [
		{ amountCents: 4200, date: new Date('2026-01-05'), id: 'a' },
		{ amountCents: 4200, date: new Date('2026-01-06'), id: 'b' },
	];

	const [result] = matchTransactions(transactions, candidates, 3);
	assert.equal(result.match, null);
	assert.equal(result.amountOnlyMatches.length, 2);
});

test('matchTransactions returns no match when no candidate has that amount', () => {
	const transactions = [tx('2026-01-05', 4200)];
	const candidates = [{ amountCents: 500, date: new Date('2026-01-05'), id: 'a' }];

	const [result] = matchTransactions(transactions, candidates, 3);
	assert.equal(result.match, null);
	assert.equal(result.amountOnlyMatches.length, 0);
});
