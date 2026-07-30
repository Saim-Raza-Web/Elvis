export function parsePaginationQuery(req, defaults = {}) {
  const all = req.query.all === 'true';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || defaults.limit || 25));
  let sort = defaults.sort || '-createdAt';

  if (req.query.sort) {
    const order = req.query.order === 'asc' ? 1 : -1;
    sort = order === 1 ? req.query.sort : `-${req.query.sort}`;
  }

  return { all, page, limit, sort };
}

function buildQuery(Model, filter, sort, options = {}) {
  let query = Model.find(filter).sort(sort);
  if (options.populate) {
    const populates = Array.isArray(options.populate) ? options.populate : [options.populate];
    populates.forEach((p) => {
      query = query.populate(p);
    });
  }
  return query;
}

export async function paginateQuery(Model, filter, req, options = {}) {
  const { all, page, limit, sort } = parsePaginationQuery(req, options);
  const query = buildQuery(Model, filter, sort, options);

  if (all) {
    const data = await buildQuery(Model, filter, sort, options);
    return {
      data,
      pagination: { page: 1, limit: data.length, total: data.length, totalPages: 1 },
    };
  }

  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    buildQuery(Model, filter, sort, options).skip(skip).limit(limit),
    Model.countDocuments(filter),
  ]);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}
