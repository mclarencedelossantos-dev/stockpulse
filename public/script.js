const state = {
  products: [],
  transactions: [],
  dashboard: null,
  businessName: 'My Business',
  ownerName: '',
  selectedProductId: null,
  activeFilter: 'All',
  searchText: '',
  salesGranularity: 'daily',
  salesAnalytics: null,
  analyticsMovementFilter: null,
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function loadProfileSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('stockpulse-profile') || '{}');
    if (typeof saved.businessName === 'string' && saved.businessName.trim()) state.businessName = saved.businessName.trim();
    if (typeof saved.ownerName === 'string' && saved.ownerName.trim()) state.ownerName = saved.ownerName.trim();
  } catch (error) {
    localStorage.removeItem('stockpulse-profile');
  }
}

function saveProfileSettings() {
  localStorage.setItem('stockpulse-profile', JSON.stringify({
    businessName: state.businessName,
    ownerName: state.ownerName,
  }));
}

function renderProfileSettings() {
  const dashboardName = document.getElementById('dashboardBusinessName');
  const ownerDisplay = document.getElementById('ownerNameDisplay');
  const businessInput = document.getElementById('businessNameInput');
  const ownerInput = document.getElementById('ownerNameInput');
  if (dashboardName) dashboardName.textContent = state.businessName;
  if (ownerDisplay && state.ownerName) ownerDisplay.textContent = state.ownerName;
  if (businessInput) businessInput.value = state.businessName;
  if (ownerInput) ownerInput.value = state.ownerName;
}

function saveBusinessName(event) {
  event.preventDefault();
  const input = document.getElementById('businessNameInput');
  const value = input.value.trim();
  if (!value) return input.focus();
  state.businessName = value;
  saveProfileSettings();
  renderProfileSettings();
  toast('Business name saved.');
}

function saveOwnerName(event) {
  event.preventDefault();
  const input = document.getElementById('ownerNameInput');
  const value = input.value.trim();
  if (!value) return input.focus();
  state.ownerName = value;
  saveProfileSettings();
  renderProfileSettings();
  toast('Owner name saved.');
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function toast(message) {
  const toastNode = document.getElementById('toast');
  if (!toastNode) return;
  toastNode.textContent = message;
  toastNode.style.display = 'block';
  clearTimeout(toastNode.dataset.timerId);
  toastNode.dataset.timerId = setTimeout(() => {
    toastNode.style.display = 'none';
  }, 2600);
}

function getProductById(productId) {
  return state.products.find((product) => product.id === productId) || null;
}

function getProductStatus(product) {
  const sold = state.transactions
    .filter((tx) => tx.productId === product.id && tx.type === 'Sale')
    .reduce((sum, tx) => sum + Number(tx.quantity || 0), 0);

  if (sold >= 30) return 'Fast-moving';
  if (sold >= 15) return 'Moderate';
  if (sold >= 8) return 'Slow-moving';
  return 'Non-moving';
}

function statusClass(value) {
  if (value === 'Fast-moving') return 'fast';
  if (value === 'Moderate') return 'moderate';
  if (value === 'Slow-moving') return 'slow';
  return 'low';
}

function formatDateTime(dateString) {
  const date = new Date(dateString);
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

async function apiRequest(url, options = {}) {
  const hasJsonBody = options.body !== undefined && options.body !== null;
  const response = await fetch(url, {
    headers: hasJsonBody ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : (options.headers || {}),
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      window.location.href = '/login';
    }
    throw new Error(data.message || 'Request failed');
  }
  return data;
}

async function loadCurrentUser() {
  try {
    const response = await apiRequest('/api/auth/me');
    const user = response.user || {};
    const userName = document.getElementById('userName') || document.getElementById('ownerNameDisplay');
    const userRole = document.getElementById('userRole');
    const menuUserName = document.getElementById('menuUserName');
    const userEmail = document.getElementById('userEmail');
    const displayName = state.ownerName || user.name || user.username || 'User';
    const displayRole = user.role === 'admin' ? 'Administrator' : 'Manager';
    if (userName) userName.textContent = displayName;
    if (userRole) userRole.textContent = displayRole;
    if (menuUserName) menuUserName.textContent = displayName;
    if (userEmail) userEmail.textContent = user.email || user.username || '';
    const menuUserRole = document.getElementById('menuUserRole');
    if (menuUserRole) menuUserRole.textContent = displayRole;
    if (!state.ownerName) state.ownerName = displayName;
    renderProfileSettings();
  } catch (error) {
    window.location.href = '/login';
  }
}

async function logoutUser() {
  try {
    await apiRequest('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    window.location.href = '/login';
  } catch (error) {
    toast(error.message || 'Unable to log out.');
  }
}

async function loadDashboard() {
  const dashboard = await apiRequest('/api/dashboard');
  state.dashboard = dashboard;
  document.getElementById('alertBadge').textContent = String(dashboard.lowStockCount || 0);
  document.getElementById('alertNavDot').hidden = Number(dashboard.lowStockCount || 0) === 0;
  document.getElementById('donutTotal').textContent = String(dashboard.totalProducts || 0);

  const stats = [
    { label: 'Total Products', value: dashboard.totalProducts || 0, icon: '♧', type: 'blue', sub: 'current catalog' },
    { label: 'Total Stock Quantity', value: (dashboard.totalStock || 0).toLocaleString(), icon: '⬡', type: 'green', sub: 'in warehouse' },
    { label: 'Total Sales (This Month)', value: formatCurrency(dashboard.salesTotal || 0), icon: '🛒', type: 'purple', sub: 'recorded sales' },
    { label: 'Low Stock Items', value: dashboard.lowStockCount || 0, icon: '⚠', type: 'red', sub: 'needs attention' },
  ];

  document.getElementById('dashboardStats').innerHTML = stats.map((item) => `
    <div class="stat">
      <div class="stat-icon ${item.type}">${item.icon}</div>
      <div>
        <label>${item.label}</label>
        <h2>${item.value}</h2>
        <div class="trend">↑ live</div>
        <div class="sub">${item.sub}</div>
      </div>
    </div>
  `).join('');

  const movement = dashboard.movement || { 'Fast-moving': 0, Moderate: 0, 'Slow-moving': 0, 'Non-moving': 0 };
  document.getElementById('movementLegend').innerHTML = [
    { label: 'Fast-moving', color: '#16a879', count: movement['Fast-moving'] },
    { label: 'Moderate', color: '#1677e8', count: movement.Moderate },
    { label: 'Slow-moving', color: '#f2ad2e', count: movement['Slow-moving'] },
    { label: 'Non-moving', color: '#e64d68', count: movement['Non-moving'] },
  ].map((item) => `
      <div>
      <i class="dot" style="background:${item.color}"></i>${item.label} <b>${item.count}</b>
    </div>
  `).join('');

  document.getElementById('topProducts').innerHTML = (dashboard.topProducts || []).map((product, index) => `
    <div class="product-mini">
      <b class="rank">${index + 1}</b>
      <span class="mini-img">${escapeHtml(product.emoji || '📦')}</span>
      <div>
        <strong>${escapeHtml(product.name)}</strong>
        <small>${product.sold} sold</small>
      </div>
    </div>
  `).join('') || '<p class="empty-note">Products will appear here after you add them and record sales.</p>';

  const alerts = dashboard.alerts || [];
  const alertHtml = alerts.length
    ? alerts.map((item) => `
      <div class="alert">
        <span class="alert-icon" style="color:var(--red)">⚠</span>
        <div>
          <strong>${escapeHtml(item.message)}</strong>
          <small>Only ${item.stock} left in inventory.</small>
        </div>
      </div>
    `).join('')
    : '<div class="alert"><span class="alert-icon" style="color:var(--green)">✓</span><div><strong>No low-stock alerts.</strong><small>Stock levels are healthy.</small></div></div>';

  document.getElementById('alertList').innerHTML = alertHtml;
  document.getElementById('alertsPageList').innerHTML = alertHtml;

  const analyticsStats = [
    { label: 'Fast-moving', value: movement['Fast-moving'], className: 'fast' },
    { label: 'Moderate', value: movement.Moderate, className: 'moderate' },
    { label: 'Slow-moving', value: movement['Slow-moving'], className: 'slow' },
    { label: 'Non-moving', value: movement['Non-moving'], className: 'low' },
  ];

  document.getElementById('analyticsStats').innerHTML = analyticsStats.map((item) => `
    <button class="stat analytics-stat" type="button" data-movement="${item.label}" aria-pressed="${state.analyticsMovementFilter === item.label}">
      <div>
        <label>${item.label}</label>
        <h2>${item.value}</h2>
        <span class="pill ${item.className}">${dashboard.totalProducts ? Math.round((item.value / dashboard.totalProducts) * 100) : 0}%</span>
      </div>
    </button>
  `).join('');
}

function renderSalesAnalytics() {
  const report = state.salesAnalytics;
  if (!report) return;

  const chart = document.getElementById('salesChart');
  const chartLabels = document.getElementById('salesChartLabels');
  document.getElementById('salesChartTotal').textContent = formatCurrency(report.totalRevenue);
  document.getElementById('salesChartUnits').textContent = Number(report.totalUnits || 0).toLocaleString();
  document.getElementById('analyticsTotalUnits').textContent = Number(report.allTimeUnits || 0).toLocaleString();

  document.querySelectorAll('#salesPeriods button').forEach((button) => {
    const isActive = button.dataset.period === state.salesGranularity;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
  document.querySelectorAll('#analyticsStats button[data-movement]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.movement === state.analyticsMovementFilter));
  });

  if (!report.totalUnits) {
    chart.classList.add('chart-empty');
    chart.textContent = `No sales recorded in the ${report.periodLabel}.`;
    chart.setAttribute('aria-label', `No sales recorded in the ${report.periodLabel}`);
    chartLabels.innerHTML = '';
  } else {
    const buckets = report.buckets || [];
    const width = 600;
    const top = 12;
    const bottom = 148;
    const left = 12;
    const right = width - left;
    const maxRevenue = Math.max(1, ...buckets.map((bucket) => Number(bucket.revenue || 0))) * 1.1;
    const points = buckets.map((bucket, index) => ({
      ...bucket,
      x: left + (index / Math.max(1, buckets.length - 1)) * (right - left),
      y: bottom - (Number(bucket.revenue || 0) / maxRevenue) * (bottom - top),
    }));
    const linePoints = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
    const areaPath = `M${points[0].x.toFixed(1)},${bottom} ${points.map((point) => `L${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')} L${points.at(-1).x.toFixed(1)},${bottom} Z`;
    chart.classList.remove('chart-empty');
    chart.setAttribute('aria-label', `Sales by ${report.granularity}, ${formatCurrency(report.totalRevenue)} across ${report.totalUnits} units`);
    chart.innerHTML = `
      <svg viewBox="0 0 ${width} 180" preserveAspectRatio="none" role="presentation">
        <line class="sales-gridline" x1="${left}" y1="${top}" x2="${right}" y2="${top}" />
        <line class="sales-gridline" x1="${left}" y1="${(top + bottom) / 2}" x2="${right}" y2="${(top + bottom) / 2}" />
        <path class="sales-area" d="${areaPath}" />
        <polyline class="sales-line" points="${linePoints}" />
        ${points.filter((point) => point.units > 0).map((point) => `<circle class="sales-point" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3"><title>${formatCurrency(point.revenue)} · ${point.units} units</title></circle>`).join('')}
      </svg>
    `;
    const labelIndexes = report.granularity === 'yearly'
      ? buckets.map((_, index) => index)
      : [...new Set([0, Math.round((buckets.length - 1) / 3), Math.round((buckets.length - 1) * 2 / 3), buckets.length - 1])];
    chartLabels.innerHTML = labelIndexes.map((index) => `<span>${escapeHtml(buckets[index].label)}</span>`).join('');
  }

  const products = report.products || [];
  const visibleProducts = state.analyticsMovementFilter
    ? products.filter((product) => product.movementStatus === state.analyticsMovementFilter)
    : products;
  document.getElementById('analyticsProductHeading').textContent = state.analyticsMovementFilter
    ? `${state.analyticsMovementFilter} products`
    : 'Units sold by product';
  document.getElementById('analyticsSalesRows').innerHTML = visibleProducts.map((product) => `
    <tr><td>${escapeHtml(product.name)}</td><td>${escapeHtml(product.category)}</td><td>${Number(product.unitsSold || 0).toLocaleString()}</td></tr>
  `).join('') || `<tr><td colspan="3">${state.analyticsMovementFilter ? `No ${escapeHtml(state.analyticsMovementFilter.toLowerCase())} products.` : 'Add products to see sales quantities here.'}</td></tr>`;
}

async function loadSalesAnalytics(granularity = state.salesGranularity) {
  state.salesGranularity = granularity;
  state.salesAnalytics = await apiRequest(`/api/analytics/sales?granularity=${encodeURIComponent(granularity)}`);
  renderSalesAnalytics();
}

async function loadProducts() {
  state.products = await apiRequest('/api/products');
  if (!state.selectedProductId && state.products.length) {
    state.selectedProductId = state.products[0].id;
  }
  renderInventory();
  renderDetails();
}

async function loadTransactions() {
  state.transactions = await apiRequest('/api/transactions');
  renderTransactions();
  renderInventory();
  renderDetails();
}

async function refreshAll() {
  try {
    await Promise.all([loadDashboard(), loadProducts(), loadTransactions(), loadSalesAnalytics()]);
  } catch (error) {
    toast(error.message || 'Unable to load data.');
  }
}

function renderInventory() {
  const filtered = state.products.filter((product) => {
    const matchesFilter = state.activeFilter === 'All' || product.category === state.activeFilter;
    const searchValue = state.searchText.trim().toLowerCase();
    const matchesSearch = !searchValue || `${product.name} ${product.id} ${product.category}`.toLowerCase().includes(searchValue);
    return matchesFilter && matchesSearch;
  });

  const productRows = filtered.map((product) => {
    const status = getProductStatus(product);
    return `
      <tr data-product-id="${escapeHtml(product.id)}">
        <td><b>${escapeHtml(product.name)}</b><div class="muted">${escapeHtml(product.id)}</div></td>
        <td>${escapeHtml(product.category)}</td>
        <td>${formatCurrency(product.price)}</td>
        <td>${product.stock}</td>
        <td><span class="pill ${statusClass(status)}">${status}</span></td>
        <td><button type="button" class="text-button" data-select-product="${escapeHtml(product.id)}">View</button></td>
      </tr>
    `;
  }).join('');
  const emptyMessage = state.products.length === 0
    ? '<div class="table-empty"><strong>Your inventory is empty</strong><p>Add a product from the Products page to start tracking stock.</p></div>'
    : '<div class="table-empty compact"><strong>No products found</strong><p>Try another search or category.</p></div>';
  document.getElementById('inventoryRows').innerHTML = productRows || `<tr><td colspan="6">${emptyMessage}</td></tr>`;

  document.getElementById('showing').textContent = `Showing ${filtered.length} product${filtered.length === 1 ? '' : 's'}`;

  const filterButtons = document.querySelectorAll('#filters button');
  filterButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.filter === state.activeFilter);
  });

  document.getElementById('productsList').innerHTML = state.products.map((product) => `
    <div class="product-list-row"><div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.id)} · ${escapeHtml(product.category)}</small></div><span>${formatCurrency(product.price)}</span><span>${Number(product.stock || 0).toLocaleString()} in stock</span></div>
  `).join('') || '<div class="empty-state"><strong>No products yet</strong><p>Add a product to build your catalog.</p><button class="primary" type="button" onclick="openProductModal()">Add product</button></div>';
  document.getElementById('productsAddButton').hidden = state.products.length === 0;

  const invAlt = document.getElementById('inventoryAlt');
  if (invAlt) {
    invAlt.innerHTML = `<p>${state.products.length} products currently loaded.</p>`;
  }
}

function renderDetails() {
  const product = getProductById(state.selectedProductId) || state.products[0];
  const details = document.getElementById('productDetails');
  if (!details) return;
  document.getElementById('editProductButton').hidden = !product;
  document.getElementById('deleteProductButton').hidden = !product;
  if (!product) {
    details.innerHTML = '<div class="detail-empty"><strong>No product selected</strong><p>Select a product to view its stock details.</p></div>';
    return;
  }

  const sold = state.transactions.filter((tx) => tx.productId === product.id && tx.type === 'Sale').reduce((sum, tx) => sum + Number(tx.quantity || 0), 0);
  const status = getProductStatus(product);

  details.innerHTML = `
    <div class="detail-top">
      <div style="flex:1">
        <div class="big-product">${escapeHtml(product.emoji || '📦')}</div>
      </div>
      <div style="flex:1.1">
        <div class="detail-name">${escapeHtml(product.name)}</div>
        <div class="muted">${escapeHtml(product.id)}</div>
        <span class="pill ${statusClass(status)}">${status}</span>
        <div class="price">${formatCurrency(product.price)}</div>
        <div class="detail-meta">
          Category: ${escapeHtml(product.category)}<br>
          Unit price: ${formatCurrency(product.price)}<br>
          Stock on hand: ${Number(product.stock || 0).toLocaleString()}<br>
          Sold: ${sold} units
        </div>
      </div>
    </div>
    <div class="detail-actions card-actions"><button type="button" class="secondary-btn" onclick="openTransactionModal('${escapeHtml(product.id)}')">New Transaction</button><button type="button" class="primary" onclick="editSelected()">Edit Product</button></div>
  `;
}

function renderTransactions() {
  const filter = document.getElementById('transactionTypeFilter')?.value || 'All';
  const visible = [...state.transactions]
    .filter((tx) => filter === 'All' || tx.type === filter)
    .slice(0, 8);

  document.getElementById('recentTransactionsBody').innerHTML = visible.map((tx) => `
    <tr>
      <td>${formatDateTime(tx.date)}</td>
      <td>${tx.productName}</td>
      <td>${tx.quantity}</td>
      <td>${tx.type === 'Sale' ? formatCurrency(tx.amount) : '₱ 0'}</td>
      <td><span class="pill ${tx.type === 'Sale' ? 'fast' : tx.type === 'Stock In' ? 'moderate' : 'low'}">${tx.type}</span></td>
    </tr>
  `).join('');

  document.getElementById('transactionsList').innerHTML = visible.map((tx) => `
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
  `).join('') || '<div class="empty-state"><strong>No transactions yet</strong><p>Transactions will appear here after you record a sale or stock movement.</p></div>';
}

function selectProduct(productId) {
  state.selectedProductId = productId;
  renderDetails();
}

function showPage(pageId) {
  document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.id === pageId));
  document.querySelectorAll('.nav button').forEach((button) => button.classList.toggle('active', button.dataset.page === pageId));
  window.scrollTo(0, 0);
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.add('hidden');
}

function openProductModal(productId = null) {
  const form = document.getElementById('productForm');
  const modal = document.getElementById('productModal');
  const title = document.getElementById('productModalTitle');
  form.reset();

  if (productId) {
    const product = getProductById(productId);
    if (!product) return;
    title.textContent = 'Edit Product';
    form.elements.namedItem('name').value = product.name;
    productIdInput(form).value = product.id;
    form.elements.namedItem('category').value = product.category;
    form.elements.namedItem('price').value = product.price;
    form.elements.namedItem('stock').value = product.stock;
    form.dataset.productId = product.id;
  } else {
    title.textContent = 'Add Product';
    form.dataset.productId = '';
    productIdInput(form).value = `NEW-${String(state.products.length + 1).padStart(3, '0')}`;
  }

  modal.classList.remove('hidden');
}

function productIdInput(form) {
  return form.elements.namedItem('id') || form.elements.namedItem('productId');
}

function openTransactionModal(productId = null) {
  const select = document.getElementById('transactionProductSelect');
  select.innerHTML = state.products.map((product) => `
    <option value="${product.id}" ${productId === product.id ? 'selected' : ''}>${product.name}</option>
  `).join('');
  document.getElementById('transactionModal').classList.remove('hidden');
}

async function submitProduct(event) {
  event.preventDefault();
  const form = event.target;
  const productId = form.dataset.productId || productIdInput(form).value;
  const payload = {
    id: productIdInput(form).value,
    name: form.elements.namedItem('name').value,
    category: form.elements.namedItem('category').value,
    price: Number(form.elements.namedItem('price').value),
    stock: Number(form.elements.namedItem('stock').value),
    sizes: [],
    colors: [],
  };

  try {
    if (form.dataset.productId) {
      await apiRequest(`/api/products/${encodeURIComponent(productId)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      toast('Product updated.');
    } else {
      await apiRequest('/api/products', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      toast('Product added.');
    }

    form.reset();
    closeModal('productModal');
    await refreshAll();
  } catch (error) {
    toast(error.message || 'Unable to save product.');
  }
}

async function submitTransaction(event) {
  event.preventDefault();
  const form = event.target;
  const payload = {
    productId: form.elements.namedItem('productId').value,
    type: form.elements.namedItem('type').value,
    quantity: Number(form.elements.namedItem('quantity').value),
  };

  try {
    await apiRequest('/api/transactions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    toast('Transaction saved.');
    form.reset();
    closeModal('transactionModal');
    await refreshAll();
  } catch (error) {
    toast(error.message || 'Unable to save transaction.');
  }
}

async function editSelected() {
  if (!state.selectedProductId) {
    toast('Select a product first.');
    return;
  }
  openProductModal(state.selectedProductId);
}

async function deleteSelected() {
  if (!state.selectedProductId) {
    toast('Select a product first.');
    return;
  }
  const product = getProductById(state.selectedProductId);
  if (!product) return;

  const confirmDelete = window.confirm(`Delete ${product.name}?`);
  if (!confirmDelete) return;

  try {
    await apiRequest(`/api/products/${encodeURIComponent(product.id)}`, { method: 'DELETE' });
    toast('Product deleted.');
    state.selectedProductId = null;
    await refreshAll();
  } catch (error) {
    toast(error.message || 'Unable to delete product.');
  }
}

function bindEvents() {
  document.getElementById('nav').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-page]');
    if (!button) return;
    showPage(button.dataset.page);
  });

  document.getElementById('filters').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-filter]');
    if (!button) return;
    state.activeFilter = button.dataset.filter;
    renderInventory();
  });

  document.getElementById('search').addEventListener('input', (event) => {
    state.searchText = event.target.value;
    renderInventory();
  });

  document.getElementById('inventoryRows').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-select-product]');
    const row = event.target.closest('tr[data-product-id]');
    const productId = button ? button.dataset.selectProduct : row && row.dataset.productId;
    if (productId) selectProduct(productId);
  });

  document.getElementById('salesPeriods').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-period]');
    if (button && button.dataset.period !== state.salesGranularity) {
      loadSalesAnalytics(button.dataset.period).catch((error) => toast(error.message || 'Unable to load sales analytics.'));
    }
  });

  document.getElementById('analyticsStats').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-movement]');
    if (!button) return;
    state.analyticsMovementFilter = state.analyticsMovementFilter === button.dataset.movement ? null : button.dataset.movement;
    renderSalesAnalytics();
  });

  document.getElementById('transactionTypeFilter').addEventListener('change', renderTransactions);
  document.getElementById('productForm').addEventListener('submit', submitProduct);
  document.getElementById('transactionForm').addEventListener('submit', submitTransaction);
  document.getElementById('businessSettingsForm')?.addEventListener('submit', saveBusinessName);
  document.getElementById('ownerSettingsForm')?.addEventListener('submit', saveOwnerName);
  (document.getElementById('logoutBtn') || document.getElementById('logoutSessionButton'))?.addEventListener('click', logoutUser);

  const accountMenuButton = document.getElementById('accountMenuButton');
  const accountMenu = document.getElementById('accountMenu');
  const setAccountMenuOpen = (isOpen) => {
    if (!accountMenuButton || !accountMenu) return;
    accountMenu.hidden = !isOpen;
    accountMenuButton.setAttribute('aria-expanded', String(isOpen));
  };
  accountMenuButton?.addEventListener('click', () => {
    setAccountMenuOpen(accountMenuButton.getAttribute('aria-expanded') !== 'true');
  });
  document.addEventListener('click', (event) => {
    if (accountMenu && accountMenuButton && !event.target.closest('.account-menu-wrap')) {
      setAccountMenuOpen(false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && accountMenuButton?.getAttribute('aria-expanded') === 'true') {
      setAccountMenuOpen(false);
      accountMenuButton.focus();
    }
  });
  document.querySelectorAll('[data-open-page]').forEach((button) => {
    button.addEventListener('click', () => showPage(button.dataset.openPage));
  });

  document.addEventListener('click', (event) => {
    if (event.target.classList.contains('modal')) {
      event.target.classList.add('hidden');
    }
  });
}

async function init() {
  loadProfileSettings();
  bindEvents();
  document.getElementById('todayDate').textContent = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  document.getElementById('todayDay').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  await loadCurrentUser();
  await refreshAll();
}

init();
