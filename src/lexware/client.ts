export class LexwareApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    url: string,
  ) {
    super(`Lexware API ${status}: ${body || "request failed"} (${url})`);
    this.name = "LexwareApiError";
  }
}

export interface VoucherListFilters {
  /** Required by the Lexware /voucherlist endpoint, e.g. purchaseinvoice, salesinvoice, creditnote. */
  voucherType: string;
  /** Required by the Lexware /voucherlist endpoint, e.g. open, paid, voided, transferred, draft. */
  voucherStatus: string;
  archived?: boolean;
  contactId?: string;
  voucherDateFrom?: string;
  voucherDateTo?: string;
  page?: number;
  size?: number;
}

export interface LexwareVoucher {
  id: string;
  voucherType: string;
  voucherStatus: string;
  voucherNumber?: string;
  voucherDate: string;
  totalAmount: number;
  openAmount?: number;
  contactName?: string;
  [key: string]: unknown;
}

export interface VoucherListPage {
  content: LexwareVoucher[];
  totalElements: number;
  totalPages: number;
  number: number;
}

export type FetchLike = typeof fetch;

export interface LexwareClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

/**
 * Thin client over the Lexware Office (formerly lexoffice) public API v1.
 * https://developers.lexware.io/docs/
 */
export class LexwareClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: LexwareClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://api.lexware.io/v1").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await this.fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new LexwareApiError(response.status, body, url);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  async listVouchers(filters: VoucherListFilters): Promise<VoucherListPage> {
    const params = new URLSearchParams();
    params.set("voucherType", filters.voucherType);
    params.set("voucherStatus", filters.voucherStatus);
    if (filters.archived !== undefined) params.set("archived", String(filters.archived));
    if (filters.contactId) params.set("contactId", filters.contactId);
    if (filters.voucherDateFrom) params.set("voucherDateFrom", filters.voucherDateFrom);
    if (filters.voucherDateTo) params.set("voucherDateTo", filters.voucherDateTo);
    params.set("page", String(filters.page ?? 0));
    params.set("size", String(filters.size ?? 100));

    return this.request<VoucherListPage>(`/voucherlist?${params.toString()}`);
  }

  async getVoucher(id: string): Promise<LexwareVoucher> {
    return this.request<LexwareVoucher>(`/vouchers/${encodeURIComponent(id)}`);
  }

  async listContacts(page = 0, size = 100): Promise<{ content: unknown[]; totalElements: number }> {
    const params = new URLSearchParams({ page: String(page), size: String(size) });
    return this.request(`/contacts?${params.toString()}`);
  }

  /** Uploads a receipt file (image/PDF) so it can be attached to a voucher. */
  async uploadFile(fileBuffer: Buffer, fileName: string, mimeType: string): Promise<{ id: string }> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), fileName);
    form.append("type", "voucher");

    const url = `${this.baseUrl}/files`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new LexwareApiError(response.status, body, url);
    }

    return (await response.json()) as { id: string };
  }
}
