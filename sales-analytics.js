const DAY_MS = 24 * 60 * 60 * 1000;

const GRANULARITIES = {
  daily: { bucketCount: 30, label: 'last 30 days' },
  monthly: { bucketCount: 12, label: 'last 12 months' },
  yearly: { bucketCount: 5, label: 'last 5 years' }
};

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function createBuckets(granularity, now) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  let start;

  if (granularity === 'monthly') {
    start = new Date(Date.UTC(year, month - 11, 1));
  } else if (granularity === 'yearly') {
    start = new Date(Date.UTC(year - 4, 0, 1));
  } else {
    start = new Date(Date.UTC(year, month, day - 29));
  }

  const { bucketCount } = GRANULARITIES[granularity];
  return Array.from({ length: bucketCount }, (_, index) => {
    let date;
    if (granularity === 'monthly') {
      date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
    } else if (granularity === 'yearly') {
      date = new Date(Date.UTC(start.getUTCFullYear() + index, 0, 1));
    } else {
      date = new Date(start.getTime() + index * DAY_MS);
    }

    const label = granularity === 'yearly'
      ? String(date.getUTCFullYear())
      : new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        month: 'short',
        ...(granularity === 'daily' ? { day: 'numeric' } : { year: '2-digit' })
      }).format(date);

    return { date: dateKey(date), label, revenue: 0, units: 0 };
  });
}

function getBucketIndex(granularity, saleDate, firstBucketDate) {
  if (granularity === 'monthly') {
    return (saleDate.getUTCFullYear() - firstBucketDate.getUTCFullYear()) * 12
      + saleDate.getUTCMonth() - firstBucketDate.getUTCMonth();
  }
  if (granularity === 'yearly') {
    return saleDate.getUTCFullYear() - firstBucketDate.getUTCFullYear();
  }
  const saleDay = Date.UTC(saleDate.getUTCFullYear(), saleDate.getUTCMonth(), saleDate.getUTCDate());
  const firstDay = Date.UTC(firstBucketDate.getUTCFullYear(), firstBucketDate.getUTCMonth(), firstBucketDate.getUTCDate());
  return Math.floor((saleDay - firstDay) / DAY_MS);
}

function movementStatus(unitsSold) {
  if (unitsSold >= 30) return 'Fast-moving';
  if (unitsSold >= 15) return 'Moderate';
  if (unitsSold >= 8) return 'Slow-moving';
  return 'Non-moving';
}

function calculateCurrentMonthSales(transactions, now = new Date()) {
  return transactions.reduce((total, transaction) => {
    if (transaction.type !== 'Sale') return total;
    const date = new Date(transaction.date);
    if (Number.isNaN(date.getTime())
      || date.getUTCFullYear() !== now.getUTCFullYear()
      || date.getUTCMonth() !== now.getUTCMonth()) return total;
    return total + Number(transaction.amount || 0);
  }, 0);
}

function buildSalesAnalytics(data, granularity = 'daily', now = new Date()) {
  if (!Object.hasOwn(GRANULARITIES, granularity)) {
    throw new RangeError('Granularity must be daily, monthly, or yearly.');
  }

  const referenceDate = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(referenceDate.getTime())) throw new TypeError('A valid reference date is required.');

  const buckets = createBuckets(granularity, referenceDate);
  const firstBucketDate = new Date(`${buckets[0].date}T00:00:00.000Z`);
  const lifetimeUnitsByProduct = new Map();
  let totalRevenue = 0;
  let totalUnits = 0;

  for (const transaction of data.transactions || []) {
    if (transaction.type !== 'Sale') continue;
    const quantity = Number(transaction.quantity || 0);
    lifetimeUnitsByProduct.set(
      transaction.productId,
      (lifetimeUnitsByProduct.get(transaction.productId) || 0) + quantity
    );

    const saleDate = new Date(transaction.date);
    if (Number.isNaN(saleDate.getTime())) continue;
    const index = getBucketIndex(granularity, saleDate, firstBucketDate);
    if (index < 0 || index >= buckets.length) continue;

    const revenue = Number(transaction.amount || 0);
    buckets[index].revenue += revenue;
    buckets[index].units += quantity;
    totalRevenue += revenue;
    totalUnits += quantity;
  }

  const products = (data.products || []).map((product) => {
    const unitsSold = lifetimeUnitsByProduct.get(product.id) || 0;
    return {
      id: product.id,
      name: product.name,
      category: product.category,
      unitsSold,
      movementStatus: movementStatus(unitsSold)
    };
  }).sort((left, right) => right.unitsSold - left.unitsSold || left.name.localeCompare(right.name));

  const lastBucket = buckets[buckets.length - 1];
  return {
    granularity,
    periodLabel: GRANULARITIES[granularity].label,
    startDate: buckets[0].date,
    endDate: lastBucket.date,
    totalRevenue,
    totalUnits,
    allTimeUnits: [...lifetimeUnitsByProduct.values()].reduce((sum, units) => sum + units, 0),
    buckets,
    products
  };
}

module.exports = { buildSalesAnalytics, calculateCurrentMonthSales };