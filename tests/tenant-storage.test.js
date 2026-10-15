const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://unit-test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-service-role-key';

const supabaseSdk = require('@supabase/supabase-js');
const supabaseSdkPath = require.resolve('@supabase/supabase-js');
const seededUsers = new Set();
const seedCalls = [];
const rows = { products: [], transactions: [] };

require.cache[supabaseSdkPath].exports.createClient = () => ({
  async rpc(name, args) {
    assert.equal(name, 'seed_user_inventory');
    seedCalls.push(args);
    if (!seededUsers.has(args.p_user_id)) {
      seededUsers.add(args.p_user_id);
      rows.products.push(...args.p_products.map((product) => ({ ...product, user_id: args.p_user_id })));
      rows.transactions.push(...args.p_transactions.map((transaction) => ({ ...transaction, user_id: args.p_user_id })));
    }
    return { data: null, error: null };
  },
  from(table) {
    return {
      select() {
        const filters = [];
        const query = {
          eq(column, value) {
            filters.push([column, value]);
            return query;
          },
          order() {
            return query;
          },
          then(resolve, reject) {
            const result = rows[table].filter((row) => filters.every(([column, value]) => row[column] === value));
            return Promise.resolve({ data: result, error: null }).then(resolve, reject);
          }
        };
        return query;
      }
    };
  }
});

const store = require('../supabase-store');

test('new users start with empty inventory and reads stay isolated', async () => {
  const firstUser = 'email:first@example.com';
  const secondUser = 'email:second@example.com';

  const firstInitialProducts = await store.listProducts(firstUser, true);
  assert.equal(seedCalls.length, 1, 'the first user should trigger one initialization RPC');
  assert.deepEqual(firstInitialProducts, []);
  assert.deepEqual(seedCalls[0].p_products, []);
  assert.deepEqual(seedCalls[0].p_transactions, []);
  assert.equal(rows.products.length, 0, 'new users should not receive demo products');
  const secondInitialProducts = await store.listProducts(secondUser, false);

  assert.deepEqual(secondInitialProducts, []);
  assert.equal(seedCalls.length, 2);
  assert.notEqual(seedCalls[0].p_user_id, seedCalls[1].p_user_id);

  rows.products.push(
    { id: 'PRODUCT-A', user_id: firstUser, name: 'First user item' },
    { id: 'PRODUCT-B', user_id: secondUser, name: 'Second user item' }
  );
  rows.transactions.push(
    { id: 'TX-A', product_id: 'PRODUCT-A', user_id: firstUser, product_name: 'First user item', type: 'Sale', quantity: 1, amount: 10, date: '2026-10-01T00:00:00.000Z' },
    { id: 'TX-B', product_id: 'PRODUCT-B', user_id: secondUser, product_name: 'Second user item', type: 'Sale', quantity: 2, amount: 20, date: '2026-10-02T00:00:00.000Z' }
  );

  const firstProducts = await store.listProducts(firstUser, true);
  const secondProducts = await store.listProducts(secondUser, false);
  assert.deepEqual(firstProducts.map((product) => product.name), ['First user item']);
  assert.deepEqual(secondProducts.map((product) => product.name), ['Second user item']);

  const firstTransactions = await store.listTransactions(firstUser, true);
  const secondTransactions = await store.listTransactions(secondUser, false);
  assert.deepEqual(firstTransactions.map((transaction) => transaction.productName), ['First user item']);
  assert.deepEqual(secondTransactions.map((transaction) => transaction.productName), ['Second user item']);
});