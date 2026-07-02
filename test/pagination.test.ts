import { describe, it, expect } from 'vitest';
import { paginate, AutoPager, type PageResponse } from '../src/pagination';

describe('paginate', () => {
  it('iterates across pages until hasMore is false', async () => {
    const pages: PageResponse<number>[] = [
      { data: [1, 2], hasMore: true },
      { data: [3, 4], hasMore: true },
      { data: [5], hasMore: false },
    ];
    const seenOffsets: number[] = [];
    let calls = 0;
    const fetchPage = async (p: { offset?: number; limit?: number }) => {
      seenOffsets.push(p.offset ?? -1);
      return pages[calls++];
    };

    const out: number[] = [];
    for await (const n of paginate(fetchPage, { limit: 2 })) out.push(n);

    expect(out).toEqual([1, 2, 3, 4, 5]);
    expect(calls).toBe(3);
    expect(seenOffsets).toEqual([0, 2, 4]); // offset advances by items yielded
  });

  it('stops when data is empty even if hasMore is true', async () => {
    const fetchPage = async (): Promise<PageResponse<number>> => ({ data: [], hasMore: true });
    const out: number[] = [];
    for await (const n of paginate(fetchPage, {})) out.push(n);
    expect(out).toEqual([]);
  });

  it('handles a single full page', async () => {
    const fetchPage = async (): Promise<PageResponse<string>> => ({ data: ['a', 'b'], hasMore: false });
    const out: string[] = [];
    for await (const s of paginate(fetchPage, { limit: 50 })) out.push(s);
    expect(out).toEqual(['a', 'b']);
  });
});

describe('AutoPager', () => {
  const makePager = () => {
    const pages: PageResponse<number>[] = [
      { data: [1, 2], hasMore: true },
      { data: [3], hasMore: false },
    ];
    let calls = 0;
    const fetchPage = (): Promise<PageResponse<number>> =>
      Promise.resolve(pages[Math.min(calls++, pages.length - 1)]);
    return new AutoPager<number>(fetchPage, { limit: 2 });
  };

  it('await resolves the first page', async () => {
    const page = await makePager();
    expect(page.data).toEqual([1, 2]);
    expect(page.hasMore).toBe(true);
  });

  it('for await iterates every item across pages', async () => {
    const out: number[] = [];
    for await (const n of makePager()) out.push(n);
    expect(out).toEqual([1, 2, 3]);
  });

  it('toArray collects items, honouring the cap', async () => {
    expect(await makePager().toArray()).toEqual([1, 2, 3]);
    expect(await makePager().toArray(2)).toEqual([1, 2]);
  });

  it('pages() yields page objects', async () => {
    const sizes: number[] = [];
    for await (const p of makePager().pages()) sizes.push(p.data?.length ?? 0);
    expect(sizes).toEqual([2, 1]);
  });
});
