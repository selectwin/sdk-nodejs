/**
 * Auto-pagination helper over the API's list envelope
 * (`{ data, hasMore, offset, limit, total }`). Wrap any generated `list*` method:
 *
 *   for await (const tx of paginate(
 *     (p) => sw.transactions.listTransactions(p),
 *     { limit: 100 },
 *   )) { ... }
 */
export interface PageResponse<T> {
  data?: T[];
  hasMore?: boolean;
  offset?: number;
  limit?: number;
  total?: number;
}

export interface PaginateParams {
  offset?: number;
  limit?: number;
  [k: string]: unknown;
}

export async function* paginate<T, P extends PaginateParams>(
  fetchPage: (params: P) => Promise<PageResponse<T>>,
  params: P,
): AsyncGenerator<T, void, unknown> {
  let offset = params.offset ?? 0;
  const limit = params.limit ?? 20;
  for (;;) {
    const page = await fetchPage({ ...params, offset, limit });
    const items = page.data ?? [];
    for (const item of items) yield item;
    if (!page.hasMore || items.length === 0) return;
    offset += items.length;
  }
}

/**
 * The value returned by every auto-paginating `list()`:
 *  - `await sw.x.list(...)`             → resolves the FIRST page (`{ data, hasMore, … }`)
 *  - `for await (const item of ...)`    → iterates EVERY item across all pages
 *  - `.pages()`                         → iterate page objects
 *  - `.toArray(max?)`                   → collect items into an array
 */
export class AutoPager<Item, Page extends PageResponse<Item> = PageResponse<Item>>
  implements AsyncIterable<Item>, PromiseLike<Page>
{
  constructor(
    private readonly fetchPage: (params: PaginateParams) => Promise<Page>,
    private readonly params: PaginateParams = {},
  ) {}

  /** Awaiting the pager resolves the first page. */
  then<TResult1 = Page, TResult2 = never>(
    onfulfilled?: ((value: Page) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.fetchPage(this.params).then(onfulfilled, onrejected);
  }

  /** Iterate every item across all pages. */
  [Symbol.asyncIterator](): AsyncIterator<Item> {
    return paginate<Item, PaginateParams>(this.fetchPage, this.params);
  }

  /** Iterate page objects (`{ data, hasMore, … }`). */
  async *pages(): AsyncGenerator<Page, void, unknown> {
    let offset = this.params.offset ?? 0;
    const limit = this.params.limit ?? 20;
    for (;;) {
      const page = await this.fetchPage({ ...this.params, offset, limit });
      yield page;
      const items = page.data ?? [];
      if (!page.hasMore || items.length === 0) return;
      offset += items.length;
    }
  }

  /** Collect items into an array, optionally capped at `max`. */
  async toArray(max = Infinity): Promise<Item[]> {
    const out: Item[] = [];
    for await (const item of this) {
      out.push(item);
      if (out.length >= max) break;
    }
    return out;
  }
}
