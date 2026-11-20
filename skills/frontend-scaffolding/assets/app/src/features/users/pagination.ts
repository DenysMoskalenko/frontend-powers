const PAGE_SIZE = 20;

/** The API's `limit` and `offset` for a 1-based page number. */
export function toListParams(page: number) {
  return { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
}

/** At least one page, so an empty list still reads "Page 1 of 1". */
export function pageCount({ total, limit }: { total: number; limit: number }) {
  return Math.max(1, Math.ceil(total / limit));
}
