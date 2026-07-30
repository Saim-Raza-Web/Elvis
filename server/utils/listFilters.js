export function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Merge base company filter with optional ?search and exact-match query params.
 * @param {object} baseFilter - e.g. { company: req.user.company }
 * @param {object} req - Express request
 * @param {{ searchFields?: string[], exact?: Record<string, string> }} options
 *   exact maps Mongo field → query param name (defaults to same key)
 */
export function buildListFilter(baseFilter, req, options = {}) {
  const { searchFields = [], exact = {} } = options;
  const filter = { ...baseFilter };

  const search = String(req.query.search || '').trim();
  if (search && searchFields.length > 0) {
    const regex = new RegExp(escapeRegex(search), 'i');
    filter.$or = searchFields.map((field) => ({ [field]: regex }));
  }

  for (const [field, queryKey] of Object.entries(exact)) {
    const param = queryKey || field;
    const val = req.query[param];
    if (val != null && val !== '' && val !== 'All') {
      filter[field] = val;
    }
  }

  return filter;
}
