const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSalesAnalytics, calculateCurrentMonthSales } = require('../sales-analytics');

const referenceDate = new Date('2026-10-12T12:00:00.000Z');
const data = {
  products: [
    { id: 'A', name: 'Alpha', category: 'Electronics' },
    { id: 'B', name: 'Beta', category: 'Other' }
  ],
  transactions: [
    { productId: 'A', type: 'Sale', quantity: 1, amount: 100, date: '2026-10-12T10:00:00.000Z' },
    { productId: 'A', type: 'Sale', quantity: 2, amount: 200, date: '2026-10-02T10:00:00.000Z' },
    { productId: 'A', type: 'Sale', quantity: 3, amount: 300, date: '2026-09-10T10:00:00.000Z' },
    { productId: 'A', type: 'Sale', quantity: 4, amount: 400, date: '2025-12-15T10:00:00.000Z' },
    { productId: 'A', type: 'Sale', quantity: 6, amount: 600, date: '2023-05-04T10:00:00.000Z' },
    { productId: 'A', type: 'Sale', quantity: 5, amount: 500, date: '2020-05-04T10:00:00.000Z' },
    { productId: 'A', type: 'Stock In', quantity: 9, amount: 0, date: '2026-10-12T11:00:00.000Z' }
  ]
};

test('daily, monthly, and yearly analytics use calendar-aligned ranges', () => {
  const daily = buildSalesAnalytics(data, 'daily', referenceDate);
  assert.equal(daily.startDate, '2026-09-13');
  assert.equal(daily.endDate, '2026-10-12');
  assert.equal(daily.totalRevenue, 300);
  assert.equal(daily.totalUnits, 3);
  assert.equal(daily.buckets.length, 30);

  const monthly = buildSalesAnalytics(data, 'monthly', referenceDate);
  assert.equal(monthly.startDate, '2025-11-01');
  assert.equal(monthly.totalRevenue, 1000);
  assert.equal(monthly.totalUnits, 10);
  assert.equal(monthly.buckets.length, 12);

  const yearly = buildSalesAnalytics(data, 'yearly', referenceDate);
  assert.equal(yearly.startDate, '2022-01-01');
  assert.equal(yearly.totalRevenue, 1600);
  assert.equal(yearly.totalUnits, 16);
  assert.equal(yearly.buckets.length, 5);
});

test('analytics includes all-time per-product movement and current-month revenue', () => {
  const result = buildSalesAnalytics(data, 'daily', referenceDate);
  assert.equal(result.allTimeUnits, 21);
  assert.deepEqual(result.products.map((product) => [product.name, product.unitsSold, product.movementStatus]), [
    ['Alpha', 21, 'Moderate'],
    ['Beta', 0, 'Non-moving']
  ]);
  assert.equal(calculateCurrentMonthSales(data.transactions, referenceDate), 300);
});

test('analytics rejects unsupported granularities', () => {
  assert.throws(() => buildSalesAnalytics(data, 'weekly', referenceDate), RangeError);
});