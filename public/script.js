const STORAGE_KEY = 'stockpulse-data';
const LOW_STOCK_THRESHOLD = 5;

const legacyDemoProducts = new Map([
  ['OST-001', ['Oversized T-Shirt', 'T-Shirts']],
  ['CP-002', ['Cargo Pants', 'Pants']],
  ['HD-003', ['Hoodie', 'Hoodies']],
  ['DJ-004', ['Denim Jacket', 'Jackets']],
  ['BS-005', ['Basic Shirt', 'T-Shirts']],
  ['SH-006', ['Shorts', 'Pants']]
]);
const legacyDemoTransactionIds = new Set(['TX-1001', 'TX-1002', 'TX-1003', 'TX-1004', 'TX-1005']);

let state = {
  products: [],
  transactions: [],
  businessName: 'My Business',
  ownerName: 'Mark Clarence',
  selectedProductId: null,
  activeFilter: 'All',
  searchText: '',
  salesGranularity: 'daily',
  analyticsMovementFilter: null
};

function toast(message) {
  const toastNode = document.getElementById('toast');
  if (!toastNode) return;
  toastNode.textContent = message;
  toastNode.style.display = 'block';
  clearTimeout(toastNode.dataset.timeoutId);
  toastNode.dataset.timeoutId = setTimeout(() => {
    toastNode.style.display = 'none';
  }, 2600);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      state.products = [];
      state.transactions = [];
      state.selectedProductId = null;
      return;
    }

    const parsed = JSON.parse(raw);
    state.businessName = typeof parsed.businessName === 'string' && parsed.businessName.trim()
      ? parsed.businessName.trim()
      : 'My Business';
    state.ownerName = typeof parsed.ownerName === 'string' && parsed.ownerName.trim()
      ? parsed.ownerName.trim()
      : 'Mark Clarence';
    const savedProducts = Array.isArray(parsed.products) ? parsed.products : [];
    const demoProductIds = new Set(savedProducts.filter((product) => {
      const legacyProduct = legacyDemoProducts.get(product.id);
      return legacyProduct && product.name === legacyProduct[0] && product.category === legacyProduct[1];
    }).map((product) => product.id));
    state.products = savedProducts.filter((product) => !demoProductIds.has(product.id));
    state.transactions = (Array.isArray(parsed.transactions) ? parsed.transactions : [])
      .filter((transaction) => !legacyDemoTransactionIds.has(transaction.id) && !demoProductIds.has(transaction.productId));
    state.selectedProductId = parsed.selectedProductId || state.products[0]?.id || null;
    if (!state.products.some((product) => product.id === state.selectedProductId)) {
      state.selectedProductId = state.products[0]?.id || null;
    }
    if (demoProductIds.size) persistState();
  } catch (error) {
    state.products = [];
    state.transactions = [];
    state.selectedProductId = null;
    persistState();
  }
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    products: state.products,
    transactions: state.transactions,
    businessName: state.businessName,
    ownerName: state.ownerName,
    selectedProductId: state.selectedProductId
  }));
}

function renderProfileDetails() {
  const ownerDisplay = document.getElementById('ownerNameDisplay');
  const dashboardHeading = document.getElementById('dashboardBusinessName');
  const businessNameInput = document.getElementById('businessNameInput');
  const ownerNameInput = document.getElementById('ownerNameInput');
  if (ownerDisplay) ownerDisplay.textContent = state.ownerName;
  if (dashboardHeading) dashboardHeading.textContent = state.businessName;
  if (businessNameInput) businessNameInput.value = state.businessName;
  if (ownerNameInput) ownerNameInput.value = state.ownerName;
}

function saveBusinessName(event) {
  event.preventDefault();
  const input = document.getElementById('businessNameInput');
  const businessName = input.value.trim();
  if (!businessName) {
    input.focus();
    toast('Enter a business name.');
    return;
  }

  state.businessName = businessName;
  persistState();
  renderProfileDetails();
  toast('Business name saved.');
}

function saveOwnerName(event) {
  event.preventDefault();
  const input = document.getElementById('ownerNameInput');
  const ownerName = input.value.trim();
  if (!ownerName) {
    input.focus();
    toast('Enter an owner name.');
    return;
  }

  state.ownerName = ownerName;
  persistState();
  renderProfileDetails();
  toast('Owner name saved.');
}

async function logoutSession() {
  try {
    const response = await fetch('/api/auth/logout', { method: 'POST' });
    if (!response.ok) throw new Error('Sign-out request failed.');
    window.location.href = '/login';
  } catch (error) {
    toast('Could not sign out. Open STOCKPULSE through its app server and try again.');
  }
}

function getProductById(id) {
  return state.products.find((p) => p.id === id) || null;
}

function getProductMovementStatus(product) {
  const soldQty = getSalesQuantity(product.id);
  if (soldQty >= 30) return 'Fast-moving';
  if (soldQty >= 15) return 'Moderate';
  if (soldQty >= 8) return 'Slow-moving';
  return 'Non-moving';
}

function statusClass(value) {
  return value === 'Fast-moving' ? 'fast' : value === 'Moderate' ? 'moderate' : value === 'Slow-moving' ? 'slow' : 'low';
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(value);
}

function formatDateTime(dateString) {
  const date = new Date(dateString);
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

function getSalesQuantity(productId) {
  return state.transactions
    .filter((tx) => tx.productId === productId && tx.type === 'Sale')
    .reduce((sum, tx) => sum + tx.quantity, 0);
}

function getProductRevenue(productId) {
  return state.transactions
    .filter((tx) => tx.productId === productId && tx.type === 'Sale')
    .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
}

function getMonthlyRevenueTotal() {
  const today = new Date();
  return state.transactions
    .filter((transaction) => {
      if (transaction.type !== 'Sale') return false;
      const saleDate = new Date(transaction.date);
      return !Number.isNaN(saleDate.getTime())
        && saleDate.getFullYear() === today.getFullYear()
        && saleDate.getMonth() === today.getMonth();
    })
    .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
}

function getMonthlySalesTotal() {
  const today = new Date();
  return state.transactions
    .filter((transaction) => {
      if (transaction.type !== 'Sale') return false;
      const saleDate = new Date(transaction.date);
      return !Number.isNaN(saleDate.getTime())
        && saleDate.getFullYear() === today.getFullYear()
        && saleDate.getMonth() === today.getMonth();
    })
    .reduce((sum, tx) => sum + tx.amount, 0);
}

function renderSalesPerformance() {
  const chart = document.getElementById('salesChart');
  const labels = document.getElementById('salesChartLabels');
  const totalNode = document.getElementById('salesChartTotal');
  const unitsNode = document.getElementById('salesChartUnits');
  if (!chart || !labels || !totalNode || !unitsNode) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const configurations = {
    daily: { bucketCount: 30, start: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29), label: 'last 30 days' },
    monthly: { bucketCount: 12, start: new Date(today.getFullYear(), today.getMonth() - 11, 1), label: 'last 12 months' },
    yearly: { bucketCount: 5, start: new Date(today.getFullYear() - 4, 0, 1), label: 'last 5 years' }
  };
  const configuration = configurations[state.salesGranularity] || configurations.daily;
  const buckets = Array.from({ length: configuration.bucketCount }, () => ({ revenue: 0, units: 0 }));

  state.transactions.forEach((transaction) => {
    if (transaction.type !== 'Sale') return;
    const soldAt = new Date(transaction.date);
    if (Number.isNaN(soldAt.getTime())) return;
    soldAt.setHours(0, 0, 0, 0);
    let bucketIndex;
    if (state.salesGranularity === 'monthly') {
      bucketIndex = (soldAt.getFullYear() - configuration.start.getFullYear()) * 12
        + soldAt.getMonth() - configuration.start.getMonth();
    } else if (state.salesGranularity === 'yearly') {
      bucketIndex = soldAt.getFullYear() - configuration.start.getFullYear();
    } else {
      bucketIndex = Math.floor((soldAt - configuration.start) / 86400000);
    }
    if (bucketIndex >= 0 && bucketIndex < buckets.length) {
      buckets[bucketIndex].revenue += Number(transaction.amount || 0);
      buckets[bucketIndex].units += Number(transaction.quantity || 0);
    }
  });

  const periodRevenue = buckets.reduce((sum, bucket) => sum + bucket.revenue, 0);
  const periodUnits = buckets.reduce((sum, bucket) => sum + bucket.units, 0);
  totalNode.textContent = formatCurrency(periodRevenue);
  unitsNode.textContent = periodUnits.toLocaleString();
  document.querySelectorAll('#salesPeriods button').forEach((button) => {
    const isActive = button.dataset.period === state.salesGranularity;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });

  if (periodUnits === 0) {
    chart.classList.add('chart-empty');
    chart.textContent = `No sales recorded in the ${configuration.label}.`;
    chart.setAttribute('aria-label', `No sales recorded in the ${configuration.label}`);
    labels.innerHTML = '';
    return;
  }

  const width = 600;
  const top = 12;
  const bottom = 148;
  const left = 12;
  const right = width - left;
  const maxRevenue = Math.max(1, ...buckets.map((bucket) => bucket.revenue)) * 1.1;
  const points = buckets.map((bucket, index) => {
    const x = left + (index / (buckets.length - 1)) * (right - left);
    const y = bottom - (bucket.revenue / maxRevenue) * (bottom - top);
    return { x, y, ...bucket };
  });
  const linePoints = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const areaPath = `M${points[0].x.toFixed(1)},${bottom} ${points.map((point) => `L${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')} L${points[points.length - 1].x.toFixed(1)},${bottom} Z`;

  chart.classList.remove('chart-empty');
  chart.setAttribute('aria-label', `Sales by ${state.salesGranularity} for the ${configuration.label}, total ${formatCurrency(periodRevenue)} and ${periodUnits} units`);
  chart.innerHTML = `
    <svg viewBox="0 0 ${width} 180" preserveAspectRatio="none" role="presentation">
      <line class="sales-gridline" x1="${left}" y1="${top}" x2="${right}" y2="${top}" />
      <line class="sales-gridline" x1="${left}" y1="${(top + bottom) / 2}" x2="${right}" y2="${(top + bottom) / 2}" />
      <path class="sales-area" d="${areaPath}" />
      <polyline class="sales-line" points="${linePoints}" />
      ${points.filter((point) => point.units > 0).map((point) => `<circle class="sales-point" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3"><title>${formatCurrency(point.revenue)} · ${point.units} units</title></circle>`).join('')}
    </svg>
  `;

  const labelIndexes = state.salesGranularity === 'yearly'
    ? buckets.map((_, index) => index)
    : [...new Set([0, Math.round((buckets.length - 1) / 3), Math.round((buckets.length - 1) * 2 / 3), buckets.length - 1])];
  labels.innerHTML = labelIndexes.map((index) => {
    let date;
    let dateOptions;
    if (state.salesGranularity === 'monthly') {
      date = new Date(configuration.start.getFullYear(), configuration.start.getMonth() + index, 1);
      dateOptions = { month: 'short', year: '2-digit' };
    } else if (state.salesGranularity === 'yearly') {
      date = new Date(configuration.start.getFullYear() + index, 0, 1);
      dateOptions = { year: 'numeric' };
    } else {
      date = new Date(configuration.start.getFullYear(), configuration.start.getMonth(), configuration.start.getDate() + index);
      dateOptions = { month: 'short', day: 'numeric' };
    }
    return `<span>${date.toLocaleDateString('en-US', dateOptions)}</span>`;
  }).join('');
}

function computeDashboardMetrics() {
  const totalProducts = state.products.length;
  const totalStock = state.products.reduce((sum, product) => sum + Number(product.stock || 0), 0);
  const lowStockCount = state.products.filter((p) => Number(p.stock) <= LOW_STOCK_THRESHOLD).length;
  const salesTotal = getMonthlySalesTotal();

  document.getElementById('totalProducts').textContent = String(totalProducts);
  document.getElementById('totalStock').textContent = totalStock.toLocaleString();
  document.getElementById('salesTotal').textContent = formatCurrency(salesTotal);
  document.getElementById('lowStockCount').textContent = String(lowStockCount);
  document.getElementById('donutTotal').textContent = String(totalProducts);
  renderSalesPerformance();

  const movement = { 'Fast-moving': 0, 'Moderate': 0, 'Slow-moving': 0, 'Non-moving': 0 };
  state.products.forEach((product) => {
    const status = getProductMovementStatus(product);
    movement[status] += 1;
  });

  const donut = document.querySelector('.donut');
  if (donut) {
    const movementColors = ['#16a879', '#1677e8', '#f2ad2e', '#e64d68'];
    let movementStart = 0;
    const movementStops = Object.values(movement).map((count, index) => {
      const movementEnd = movementStart + (count / Math.max(1, totalProducts)) * 100;
      const stop = `${movementColors[index]} ${movementStart}% ${movementEnd}%`;
      movementStart = movementEnd;
      return stop;
    });
    donut.style.background = totalProducts ? `conic-gradient(${movementStops.join(', ')})` : '#e8eef5';
  }

  const totalMovement = Math.max(1, totalProducts);
  const legendHtml = [
    { label: 'Fast-moving', color: '#16a879', count: movement['Fast-moving'], value: ((movement['Fast-moving'] / totalMovement) * 100).toFixed(0) },
    { label: 'Moderate', color: '#1677e8', count: movement['Moderate'], value: ((movement['Moderate'] / totalMovement) * 100).toFixed(0) },
    { label: 'Slow-moving', color: '#f2ad2e', count: movement['Slow-moving'], value: ((movement['Slow-moving'] / totalMovement) * 100).toFixed(0) },
    { label: 'Non-moving', color: '#e64d68', count: movement['Non-moving'], value: ((movement['Non-moving'] / totalMovement) * 100).toFixed(0) }
  ].map((item) => `
    <div>
      <i class="dot" style="background:${item.color}"></i>${item.label} <b>${item.count}</b>
    </div>
  `).join('');
  document.getElementById('movementLegend').innerHTML = legendHtml;

  const topProducts = [...state.products]
    .sort((a, b) => getSalesQuantity(b.id) - getSalesQuantity(a.id) || getProductRevenue(b.id) - getProductRevenue(a.id))
    .slice(0, 5)
    .map((product, index) => {
      const revenue = getProductRevenue(product.id);
      return `
      <div class="product-mini">
        <b class="rank">${index + 1}</b>
        <span class="mini-img">${product.emoji || '📦'}</span>
        <div>
          <strong>${product.name}</strong>
          <div style="display:flex;gap:8px">
            <small>${getSalesQuantity(product.id)} sold</small>
            <small>${formatCurrency(revenue)}</small>
          </div>
        </div>
      </div>
      `;
    }).join('');
  document.getElementById('topProducts').innerHTML = topProducts || '<p>No products added yet.</p>';

  const lowStockProducts = state.products.filter((product) => Number(product.stock) <= LOW_STOCK_THRESHOLD);
  const alerts = lowStockProducts.slice(0, 4);
  const alertHtml = alerts.length
    ? alerts.map((product) => `
        <div class="alert">
          <span class="alert-icon" style="color:var(--red)">⚠</span>
          <div>
            <strong>${product.name} is running low in stock.</strong>
            <small>Only ${product.stock} left in inventory.</small>
          </div>
        </div>
      `).join('')
    : '<div class="alert"><span class="alert-icon" style="color:var(--green)">✓</span><div><strong>No low-stock alerts.</strong><small>Stock levels are healthy.</small></div></div>';

  const emptyAlerts = '<div class="alert"><span class="alert-icon" style="color:var(--muted)">·</span><div><strong>No products to monitor yet.</strong><small>Add products to see stock alerts.</small></div></div>';
  document.getElementById('alertList').innerHTML = state.products.length ? alertHtml : emptyAlerts;
  document.getElementById('alertsPageList').innerHTML = state.products.length ? alertHtml : emptyAlerts;
  document.getElementById('alertBadge').textContent = String(lowStockProducts.length);
  document.getElementById('alertNavDot').hidden = lowStockProducts.length === 0;

  const salesByProduct = new Map();
  let totalUnitsSold = 0;
  let totalRevenue = 0;
  state.transactions.forEach((transaction) => {
    if (transaction.type !== 'Sale') return;
    const quantity = Number(transaction.quantity || 0);
    const amount = Number(transaction.amount || 0);
    totalUnitsSold += quantity;
    totalRevenue += amount;
    salesByProduct.set(transaction.productId, (salesByProduct.get(transaction.productId) || 0) + quantity);
  });
  document.getElementById('analyticsTotalUnits').textContent = totalUnitsSold.toLocaleString();
  const analyticsTotalRevenue = document.getElementById('analyticsTotalRevenue');
  if (analyticsTotalRevenue) analyticsTotalRevenue.textContent = formatCurrency(totalRevenue);
  const productSales = [...state.products]
    .map((product) => ({
      ...product,
      unitsSold: salesByProduct.get(product.id) || 0,
      revenue: getProductRevenue(product.id),
      movementStatus: getProductMovementStatus(product)
    }))
    .sort((a, b) => b.unitsSold - a.unitsSold || a.name.localeCompare(b.name));
  const visibleProductSales = state.analyticsMovementFilter
    ? productSales.filter((product) => product.movementStatus === state.analyticsMovementFilter)
    : productSales;
  const productHeading = document.getElementById('analyticsProductHeading');
  if (productHeading) {
    productHeading.textContent = state.analyticsMovementFilter
      ? `${state.analyticsMovementFilter} products`
      : 'Units sold by product';
  }
  document.getElementById('analyticsSalesRows').innerHTML = visibleProductSales.map((product) => `
    <tr>
      <td>${product.name}</td>
      <td>${product.category}</td>
      <td>${product.unitsSold.toLocaleString()}</td>
      <td>${formatCurrency(product.revenue)}</td>
    </tr>
  `).join('') || `<tr><td colspan="4">${state.analyticsMovementFilter ? `No ${state.analyticsMovementFilter.toLowerCase()} products.` : 'Add products to see sales quantities here.'}</td></tr>`;

  const analyticsStats = [
    { label: 'Fast-moving', value: movement['Fast-moving'], className: 'fast' },
    { label: 'Moderate', value: movement['Moderate'], className: 'moderate' },
    { label: 'Slow-moving', value: movement['Slow-moving'], className: 'slow' },
    { label: 'Non-moving', value: movement['Non-moving'], className: 'low' }
  ];

  document.getElementById('analyticsStats').innerHTML = analyticsStats.map((item) => `
    <button class="stat analytics-stat" type="button" data-movement="${item.label}" aria-pressed="${state.analyticsMovementFilter === item.label}">
      <div>
        <label>${item.label}</label>
        <h2>${item.value}</h2>
        <span class="pill ${item.className}">${item.value ? Math.round((item.value / totalMovement) * 100) : 0}%</span>
      </div>
    </button>
  `).join('');
}

function getFilteredProducts() {
  const search = state.searchText.trim().toLowerCase();

  return state.products.filter((product) => {
    const matchesFilter = state.activeFilter === 'All' || product.category === state.activeFilter;
    const matchesSearch = !search || `${product.name} ${product.id} ${product.category}`.toLowerCase().includes(search);
    return matchesFilter && matchesSearch;
  });
}

function renderInventory() {
  const filtered = getFilteredProducts();
  const rows = filtered.map((product) => {
    const movementStatus = getProductMovementStatus(product);
    const productRow = `
      <tr onclick="selectProduct('${product.id}')">
        <td><div class="item-img">${product.emoji || '📦'}</div></td>
        <td><b>${product.name}</b><div class="muted">${product.id}</div></td>
        <td>${product.category}</td>
        <td>
          ${formatCurrency(product.price)}
        </td>
        <td>${product.stock}</td>
        <td><span class="pill ${statusClass(movementStatus)}">${movementStatus}</span></td>
        <td><button type="button" onclick="event.stopPropagation(); selectProduct('${product.id}')" style="background:none">•••</button></td>
      </tr>
    `;
    return productRow;
  }).join('');

  const emptyMessage = state.products.length
    ? '<tr><td colspan="7">No products match your search or category.</td></tr>'
    : '<tr><td colspan="7"><div class="inventory-empty"><strong>Your inventory is empty</strong><p>Add products from the Products page to start tracking stock.</p></div></td></tr>';
  document.getElementById('inventoryRows').innerHTML = rows || emptyMessage;
  document.getElementById('showing').textContent = `Showing ${filtered.length} product${filtered.length === 1 ? '' : 's'}`;

  document.getElementById('productsList').innerHTML = state.products.map((product) => `
    <div class="product-item" onclick="selectProduct('${product.id}')">
      <span style="font-size:18px;margin-right:6px">${product.emoji || '📦'}</span>
      <b>${product.name}</b> — <span class="muted">${product.id}</span> — ${formatCurrency(product.price)} — <b>${product.stock}</b> in stock
    </div>
  `).join('') || '<div class="inventory-empty"><strong>No products yet</strong><p>Your catalog will appear here when you add products.</p><button class="primary" type="button" onclick="openProductModal()">Add product</button></div>';
  document.getElementById('productsAddButton').hidden = state.products.length === 0;

  const filters = document.querySelectorAll('#filters button');
  filters.forEach((button) => button.classList.toggle('active', button.dataset.filter === state.activeFilter));
}

function selectProduct(productId) {
  state.selectedProductId = productId;
  persistState();
  renderDetails();
}

function renderDetails() {
  const product = getProductById(state.selectedProductId) || state.products[0];
  if (!product) {
    document.getElementById('productDetails').innerHTML = '<div class="inventory-empty"><strong>No product selected</strong><p>Product details will appear here when you add products from the Products page.</p></div>';
    return;
  }

  const movementStatus = getProductMovementStatus(product);
  const salesCount = getSalesQuantity(product.id);
  document.getElementById('productDetails').innerHTML = `
    <div class="detail-top">
      <div style="flex:1">
        <div class="big-product">${product.emoji || '📦'}</div>
      </div>
      <div style="flex:1.1">
        <div class="detail-name">${product.name}</div>
        <div class="muted">${product.id}</div>
        <span class="pill ${statusClass(movementStatus)}">${movementStatus}</span>
        <div class="price">${formatCurrency(product.price)}</div>
        <div class="detail-meta">
          Category: ${product.category}<br>
          Unit price: ${formatCurrency(product.price)}<br>
          Stock on hand: ${product.stock}<br>
          Sold: ${salesCount} units
        </div>
      </div>
    </div>
    <div class="detail-actions card-actions">
      <button type="button" class="secondary-btn" onclick="openTransactionModal(productId='${product.id}')">New Transaction</button>
      <button type="button" class="primary" onclick="editSelected()">Edit Product</button>
    </div>
  `;
}

function openProductModal(productId = null) {
  const form = document.getElementById('productForm');
  const modal = document.getElementById('productModal');
  const modalTitle = document.getElementById('productModalTitle');
  form.reset();

  if (productId) {
    const product = getProductById(productId);
    if (!product) return;

    modalTitle.textContent = 'Edit Product';
    form.name.value = product.name;
    form.elements.namedItem('id').value = product.id;
    form.category.value = product.category;
    form.price.value = product.price;
    form.stock.value = product.stock;
    form.dataset.editId = productId;
  } else {
    modalTitle.textContent = 'Add Product';
    form.dataset.editId = '';
    form.elements.namedItem('id').value = `NEW-${String(state.products.length + 1).padStart(3, '0')}`;
  }

  modal.classList.remove('hidden');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.add('hidden');
}

function openTransactionModal(productId = null) {
  const select = document.getElementById('transactionProductSelect');
  if (!state.products.length) {
    toast('Add a product before recording a transaction.');
    return;
  }
  select.innerHTML = state.products.map((product) => `
    <option value="${product.id}" ${productId === product.id ? 'selected' : ''}>${product.name}</option>
  `).join('');
  document.getElementById('transactionModal').classList.remove('hidden');
}

function addProductFromForm(event) {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const name = (data.get('name') || '').trim();
  const productId = (data.get('id') || '').trim();
  const category = data.get('category') || 'Other';
  const price = Number(data.get('price')) || 0;
  const stock = Number(data.get('stock')) || 0;

  if (!name || !productId) {
    toast('Please provide the required product information.');
    return;
  }

  const isEdit = Boolean(form.dataset.editId);
  if (isEdit) {
    const existing = getProductById(form.dataset.editId);
    if (!existing) return;

    existing.name = name;
    existing.id = productId;
    existing.category = category;
    existing.price = price;
    existing.stock = stock;
    state.selectedProductId = existing.id;
    toast('Product updated successfully.');
  } else {
    const newProduct = {
      id: productId,
      name,
      category,
      emoji: '📦',
      price,
      stock
    };
    state.products.push(newProduct);
    state.selectedProductId = productId;
    toast('Product added successfully.');
  }

  persistState();
  renderInventory();
  renderDetails();
  computeDashboardMetrics();
  closeModal('productModal');
}

function editSelected() {
  if (!state.selectedProductId) {
    toast('Please select a product first.');
    return;
  }
  openProductModal(state.selectedProductId);
}

function deleteSelected() {
  if (!state.selectedProductId) {
    toast('Please select a product first.');
    return;
  }
  const product = getProductById(state.selectedProductId);
  if (!product) return;

  const confirmDelete = window.confirm(`Delete ${product.name}?`);
  if (!confirmDelete) return;

  state.products = state.products.filter((p) => p.id !== product.id);
  state.transactions = state.transactions.filter((tx) => tx.productId !== product.id);
  state.selectedProductId = state.products[0]?.id || null;
  persistState();
  renderInventory();
  renderDetails();
  computeDashboardMetrics();
  toast('Product deleted.');
}

function recordTransaction(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const productId = formData.get('productId') || '';
  const type = formData.get('type') || 'Sale';
  const quantity = Number(formData.get('quantity')) || 0;

  if (!productId || !quantity) {
    toast('Please complete transaction details.');
    return;
  }

  const product = getProductById(productId);
  if (!product) {
    toast('Selected product not found.');
    return;
  }

  if (type === 'Sale' && product.stock < quantity) {
    toast('Not enough stock for this sale.');
    return;
  }

  const tx = {
    id: `TX-${Date.now()}`,
    productId: product.id,
    productName: product.name,
    type,
    quantity,
    amount: type === 'Sale' ? product.price * quantity : 0,
    date: new Date().toISOString()
  };

  state.transactions.unshift(tx);

  if (type === 'Sale') {
    product.stock = Math.max(0, Number(product.stock) - quantity);
  } else if (type === 'Stock In') {
    product.stock = Number(product.stock) + quantity;
  } else if (type === 'Return') {
    product.stock = Math.max(0, Number(product.stock) + quantity);
  }

  persistState();
  renderInventory();
  renderDetails();
  computeDashboardMetrics();
  renderTransactions();
  closeModal('transactionModal');
  form.reset();
  toast(`${type} recorded successfully.`);
}

function renderTransactions() {
  const transactionType = document.getElementById('transactionTypeFilter')?.value || 'All';
  const txs = [...state.transactions]
    .filter((tx) => transactionType === 'All' || tx.type === transactionType)
    .slice(0, 8);

  document.getElementById('recentTransactionsBody').innerHTML = txs.map((tx) => `
    <tr>
      <td>${formatDateTime(tx.date)}</td>
      <td>${tx.productName}</td>
      <td>${tx.quantity}</td>
      <td>${tx.type === 'Sale' ? formatCurrency(tx.amount) : '₱ 0'}</td>
      <td><span class="pill ${tx.type === 'Sale' ? 'fast' : tx.type === 'Stock In' ? 'moderate' : 'low'}">${tx.type}</span></td>
    </tr>
  `).join('') || '<tr><td colspan="5">No transactions yet.</td></tr>';

  document.getElementById('transactionsList').innerHTML = txs.map((tx) => `
    <div class="transaction-card">
      <div>
        <strong>${tx.productName}</strong>
        <small>${tx.type} • ${tx.quantity} unit${tx.quantity > 1 ? 's' : ''}</small>
      </div>
      <div class="transaction-meta">
        <span>${formatDateTime(tx.date)}</span>
        <span class="pill ${tx.type === 'Sale' ? 'fast' : tx.type === 'Stock In' ? 'moderate' : 'low'}">${tx.type}</span>
      </div>
    </div>
  `).join('') || '<p>No transactions yet.</p>';
}

function showPage(id) {
  document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.id === id));
  document.querySelectorAll('.nav button').forEach((button) => button.classList.toggle('active', button.dataset.page === id));
  window.scrollTo(0, 0);
}

function initEvents() {
  document.getElementById('nav').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-page]');
    if (button) showPage(button.dataset.page);
  });

  document.getElementById('filters').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-filter]');
    if (!button) return;
    state.activeFilter = button.dataset.filter;
    renderInventory();
  });

  document.getElementById('salesPeriods').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-period]');
    if (!button) return;
    state.salesGranularity = button.dataset.period;
    renderSalesPerformance();
  });

  document.getElementById('analyticsStats').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-movement]');
    if (!button) return;
    state.analyticsMovementFilter = state.analyticsMovementFilter === button.dataset.movement
      ? null
      : button.dataset.movement;
    computeDashboardMetrics();
  });

  document.getElementById('search').addEventListener('input', (event) => {
    state.searchText = event.target.value;
    renderInventory();
  });

  document.getElementById('transactionTypeFilter')?.addEventListener('change', renderTransactions);

  document.getElementById('productForm').addEventListener('submit', addProductFromForm);
  document.getElementById('transactionForm').addEventListener('submit', recordTransaction);
  document.getElementById('businessSettingsForm').addEventListener('submit', saveBusinessName);
  document.getElementById('ownerSettingsForm').addEventListener('submit', saveOwnerName);
  document.getElementById('logoutSessionButton').addEventListener('click', logoutSession);

  document.addEventListener('click', (event) => {
    if (event.target.classList.contains('modal')) {
      event.target.classList.add('hidden');
    }
  });
}

function setup() {
  loadState();
  initEvents();
  renderProfileDetails();
  renderInventory();
  renderDetails();
  computeDashboardMetrics();
  renderTransactions();
  document.getElementById('todayDate').textContent = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  document.getElementById('todayDay').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long' });
}

setup();

 
