import { parse } from "csv-parse/sync";

export interface BankTransaction {
  date: Date;
  amountCents: number;
  raw: Record<string, string>;
}

export interface ParseBankCsvOptions {
  /** Column name holding the booking date. Defaults: Datum, Date, Buchungstag */
  dateColumn?: string;
  /** Column name holding the EUR amount. Defaults: Betrag, Amount */
  amountColumn?: string;
  delimiter?: string;
}

const DATE_CANDIDATES = ["Datum", "Date", "Buchungstag", "Valutadatum"];
const AMOUNT_CANDIDATES = ["Betrag", "Amount", "Umsatz", "Betrag (EUR)"];

function pickColumn(row: Record<string, string>, explicit: string | undefined, candidates: string[]): string {
  if (explicit) return explicit;
  const found = candidates.find((c) => c in row);
  if (!found) {
    throw new Error(
      `Could not find a matching column in CSV header. Tried: ${candidates.join(", ")}. ` +
        `Found columns: ${Object.keys(row).join(", ")}`,
    );
  }
  return found;
}

/** Parses "1.234,56" or "1234.56" or "-42,00" into integer cents. */
export function parseEuroAmountToCents(raw: string): number {
  const trimmed = raw.trim().replace(/€/g, "").trim();
  const negative = /^-/.test(trimmed) || /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed.replace(/[()-]/g, "");

  let normalized: string;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    // Thousands separator is whichever comes first.
    normalized = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  } else if (cleaned.includes(",")) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    normalized = cleaned;
  }

  const value = Number(normalized);
  if (Number.isNaN(value)) {
    throw new Error(`Could not parse amount: "${raw}"`);
  }
  return Math.round(value * 100) * (negative ? -1 : 1);
}

/** Parses "31.12.2025", "2025-12-31", or "31/12/2025" into a Date (UTC midnight). */
export function parseGermanOrIsoDate(raw: string): Date {
  const trimmed = raw.trim();

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  }

  const dmyMatch = trimmed.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  }

  throw new Error(`Could not parse date: "${raw}"`);
}

/**
 * Picks the field delimiter from the header line only. Auto-detecting across the
 * whole file is unsafe here: German bank exports use ";" as the delimiter precisely
 * because amounts use "," as the decimal separator, so a comma-count over data rows
 * would misfire on every amount field.
 */
function sniffDelimiter(csvContent: string): string {
  const headerLine = csvContent.split(/\r?\n/, 1)[0] ?? "";
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  return semicolons >= commas ? ";" : ",";
}

export function parseBankCsv(csvContent: string, options: ParseBankCsvOptions = {}): BankTransaction[] {
  const rows: Record<string, string>[] = parse(csvContent, {
    columns: true,
    delimiter: options.delimiter ?? sniffDelimiter(csvContent),
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  return rows.map((row) => {
    const dateColumn = pickColumn(row, options.dateColumn, DATE_CANDIDATES);
    const amountColumn = pickColumn(row, options.amountColumn, AMOUNT_CANDIDATES);
    return {
      date: parseGermanOrIsoDate(row[dateColumn]),
      amountCents: parseEuroAmountToCents(row[amountColumn]),
      raw: row,
    };
  });
}
