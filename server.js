const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const session = require('express-session');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');
require('dotenv').config();
const supabaseStore = require('./supabase-store');
const { generateTOTPSecret, getTOTPUri, verifyTOTP } = require('./auth/totp');
const { buildSalesAnalytics, calculateCurrentMonthSales } = require('./sales-analytics');

const app = express();
const LOW_STOCK_THRESHOLD = 5;

function resolveConfiguredPort() {
  const dotEnvPath = path.join(__dirname, '.env');
  let filePort = null;

  try {
    const dotEnvContents = fs.readFileSync(dotEnvPath, 'utf8');
    const portMatch = dotEnvContents.match(/^\s*PORT\s*=\s*(\d+)\s*$/m);
    filePort = portMatch ? Number(portMatch[1]) : null;
  } catch (error) {
    filePort = null;
  }

  const environmentPort = Number(process.env.PORT);
  if (Number.isFinite(environmentPort) && environmentPort > 0) return environmentPort;
  return Number.isFinite(filePort) && filePort > 0 ? filePort : 3000;
}

const PORT = resolveConfiguredPort();
const hasStableSessionSecret = Boolean(process.env.SESSION_SECRET);
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const OTP_SECRET = process.env.OTP_SECRET || SESSION_SECRET;
const devEmailMode = process.env.EMAIL_DEV_MODE === 'true' || process.env.EMAIL_DEV_MODE === '1';
const devCodeSignInEnabled = devEmailMode && process.env.NODE_ENV !== 'production';
const openEmailSignup = process.env.OPEN_EMAIL_SIGNUP === 'true';
const allowedLoginEmails = new Set((process.env.ALLOWED_LOGIN_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean));
const adminEmails = new Set((process.env.ADMIN_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean));
const smtpPort = Number(process.env.SMTP_PORT || 587);

function looksLikePlaceholder(value) {
  const text = String(value || '').trim().toLowerCase();
  return !text || /replace-with|your-|smtp\.your-email-provider|example\.com|demo\./.test(text);
}

const smtpTransport = !looksLikePlaceholder(process.env.SMTP_HOST)
  && !looksLikePlaceholder(process.env.SMTP_USER)
  && !looksLikePlaceholder(process.env.SMTP_PASS)
  && !looksLikePlaceholder(process.env.SMTP_FROM)
  && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM
  ? nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: smtpPort,
    secure: process.env.SMTP_SECURE === 'true' || smtpPort === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  })
  : null;
if (!supabaseStore.configured) {
  throw new Error('Supabase is required. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.');
}
if (process.env.NODE_ENV === 'production' && !hasStableSessionSecret) {
  throw new Error('SESSION_SECRET must be set to a stable, private value in production.');
}

function isEmailAuthConfigured() {
  return Boolean((smtpTransport && (openEmailSignup || allowedLoginEmails.size > 0) && OTP_SECRET) || (devCodeSignInEnabled && OTP_SECRET));
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isEmailAllowed(email) {
  return openEmailSignup || allowedLoginEmails.size === 0 || allowedLoginEmails.has(email);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hashEmailCode(email, code) {
  return crypto.createHmac('sha256', OTP_SECRET).update(`${email}:${code}`).digest('hex');
}

function roleForEmail(email) {
  if (adminEmails.size) return adminEmails.has(email) ? 'admin' : 'manager';
  return email === [...allowedLoginEmails][0] ? 'admin' : 'manager';
}

function saveSessionUser(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((regenerateError) => {
      if (regenerateError) return reject(regenerateError);
      req.session.user = user;
      delete req.session.pendingTotpEmail;
      req.session.save((saveError) => saveError ? reject(saveError) : resolve());
    });
  });
}

async function getUserRecordForEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  const existingUser = await supabaseStore.getUserByEmail(normalizedEmail);
  if (existingUser) return existingUser;
  return supabaseStore.getOrCreateEmailUser(normalizedEmail, normalizedEmail, roleForEmail(normalizedEmail));
}

async function updateUserTOTP(email, secret, enabled) {
  return supabaseStore.setUserTOTP(normalizeEmail(email), secret, enabled);
}

function buildSessionUser(user) {
  return {
    id: user.id || `email:${normalizeEmail(user.email || user.username)}`,
    username: user.email || user.username || 'user',
    email: user.email || user.username || 'user',
    name: user.name || user.email || user.username || 'User',
    role: user.role || 'manager',
    provider: user.provider || 'email'
  };
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}
app.use(session({
  secret: SESSION_SECRET,
  store: new supabaseStore.SupabaseSessionStore(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 8,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));
app.use((req, res, next) => {
  if (req.path === '/index.html' && (!req.session || !req.session.user)) {
    return res.redirect('/login');
  }
  return next();
});
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, '.vscode', 'style.css')));
app.get('/script.js', (req, res) => res.sendFile(path.join(__dirname, '.vscode', 'script.js')));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ message: 'Unauthorized. Please sign in.' });
  }
  next();
}

function slugifyName(name) {
  return String(name || 'Item')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

function getEmojiForCategory(category) {
  const map = {
    Electronics: 'Ã°Å¸â€™Â»',
    'Home & Living': 'Ã°Å¸ÂÂ ',
    'Food & Beverage': 'Ã°Å¸â€ºÂ',
    'Health & Beauty': 'Ã¢Å“Â¨',
    'Office Supplies': 'Ã¢Å“ÂÃ¯Â¸Â',
    Other: 'Ã°Å¸â€œÂ¦'
  };
  return map[category] || 'Ã°Å¸â€œÂ¦';
}

function getProductStatus(productId, transactionList) {
  const sales = transactionList
    .filter((tx) => tx.productId === productId && tx.type === 'Sale')
    .reduce((sum, tx) => sum + Number(tx.quantity || 0), 0);

  if (sales >= 30) return 'Fast-moving';
  if (sales >= 15) return 'Moderate';
  if (sales >= 8) return 'Slow-moving';
  return 'Non-moving';
}

function getDashboardStats(data) {
  const products = data.products || [];
  const transactions = data.transactions || [];

  const totalProducts = products.length;
  const totalStock = products.reduce((sum, product) => sum + Number(product.stock || 0), 0);
  const lowStockCount = products.filter((product) => Number(product.stock || 0) <= LOW_STOCK_THRESHOLD).length;
  const salesTotal = calculateCurrentMonthSales(transactions);

  const movement = { 'Fast-moving': 0, Moderate: 0, 'Slow-moving': 0, 'Non-moving': 0 };
  products.forEach((product) => {
    const status = getProductStatus(product.id, transactions);
    movement[status] = (movement[status] || 0) + 1;
  });

  const topProducts = [...products]
    .map((product) => ({
      ...product,
      sold: transactions
        .filter((tx) => tx.productId === product.id && tx.type === 'Sale')
        .reduce((sum, tx) => sum + Number(tx.quantity || 0), 0)
    }))
    .sort((a, b) => b.sold - a.sold)
    .slice(0, 5)
    .map((product) => ({
      id: product.id,
      name: product.name,
      emoji: product.emoji,
      sold: product.sold
    }));

  const alerts = products
    .filter((product) => Number(product.stock || 0) <= LOW_STOCK_THRESHOLD)
    .slice(0, 4)
    .map((product) => ({
      id: product.id,
      name: product.name,
      stock: Number(product.stock || 0),
      message: `${product.name} is running low in stock.`
    }));

  return {
    totalProducts,
    totalStock,
    salesTotal,
    lowStockCount,
    alerts,
    movement,
    topProducts
  };
}

app.get('/api/auth/config', (req, res) => {
  res.json({
    emailEnabled: isEmailAuthConfigured(),
    totpEnabled: true,
    authMode: 'totp'
  });
});

app.post('/api/auth/totp/setup', asyncRoute(async (req, res) => {
  const email = normalizeEmail(req.session && req.session.pendingTotpEmail || req.session && req.session.user && req.session.user.email || req.body && req.body.email);
  if (!email) {
    return res.status(400).json({ message: 'A valid email is required to set up Google Authenticator.' });
  }

  const user = await getUserRecordForEmail(email);
  const secret = user.totpSecret || generateTOTPSecret();
  const otpauthUri = getTOTPUri(email, secret, 'STOCKPULSE');
  const qrCode = await QRCode.toDataURL(otpauthUri);

  if (!user.totpEnabled) {
    await updateUserTOTP(email, secret, false);
  }

  res.json({
    secret,
    otpauthUri,
    qrCode,
    email,
    needsVerification: true
  });
}));

app.post('/api/auth/totp/enable', asyncRoute(async (req, res) => {
  const email = normalizeEmail(req.session && req.session.pendingTotpEmail || req.session && req.session.user && req.session.user.email || req.body && req.body.email);
  const code = String(req.body && req.body.code || '').trim();
  if (!email || !/^[0-9]{6}$/.test(code)) {
    return res.status(400).json({ message: 'Enter the 6-digit code from Google Authenticator.' });
  }

  const user = await getUserRecordForEmail(email);
  if (!user || !user.totpSecret) {
    return res.status(400).json({ message: 'Generate a Google Authenticator secret before enabling it.' });
  }

  if (!verifyTOTP(user.totpSecret, code, 1)) {
    return res.status(401).json({ message: 'The Google Authenticator code is invalid or expired.' });
  }

  const updatedUser = await updateUserTOTP(email, user.totpSecret, true);
  const sessionUser = buildSessionUser(updatedUser);
  await saveSessionUser(req, sessionUser);
  return res.json({ message: 'Google Authenticator is enabled.', user: sessionUser });
}));

app.post('/api/auth/totp/verify', asyncRoute(async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const code = String(req.body && req.body.code || '').trim();
  if (!email || !/^[0-9]{6}$/.test(code)) {
    return res.status(400).json({ message: 'Enter the email address and 6-digit Google Authenticator code.' });
  }

  const user = await getUserRecordForEmail(email);
  if (!user || !user.totpEnabled || !user.totpSecret) {
    return res.status(401).json({ message: 'Google Authenticator is not configured for this account.' });
  }

  if (!verifyTOTP(user.totpSecret, code, 1)) {
    return res.status(401).json({ message: 'The Google Authenticator code is invalid or expired.' });
  }

  const sessionUser = buildSessionUser(user);
  await saveSessionUser(req, sessionUser);
  return res.json({ message: 'Signed in.', user: sessionUser });
}));

app.get('/login', (req, res) => {
  if (req.session && req.session.user) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/testing-login', asyncRoute(async (req, res) => {
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_TEST_LOGIN !== 'true') {
    return res.sendStatus(404);
  }

  const demoUser = {
    id: 'testing-demo',
    username: 'demo@stockpulse.test',
    email: 'demo@stockpulse.test',
    name: 'Demo User',
    role: 'admin',
    provider: 'testing'
  };
  await saveSessionUser(req, demoUser);
  res.redirect('/');
}));

app.get('/api/auth/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  res.json({ user: req.session.user });
});

app.post('/api/auth/email/request-code', asyncRoute(async (req, res) => {
  if (!isEmailAuthConfigured()) {
    return res.status(503).json({ message: 'Email sign-in is not configured. Set SMTP credentials and ALLOWED_LOGIN_EMAILS.' });
  }

  const email = normalizeEmail(req.body && req.body.email);
  if (!isValidEmail(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
  if (!devCodeSignInEnabled && !isEmailAllowed(email)) {
    return res.status(202).json({ message: 'If this address is approved, a sign-in code will arrive shortly.' });
  }

  const now = Date.now();
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  const codeHash = hashEmailCode(email, code);
  const request = await supabaseStore.requestEmailCode(email, codeHash, now);
  if (request.limited) {
    return res.status(429).json({ message: 'Please wait before requesting another code.', retryAfterSeconds: request.retryAfterSeconds });
  }

  if (devCodeSignInEnabled) {
    console.log(`[DEV EMAIL CODE] ${email} => ${code}`);
    return res.status(202).json({
      message: 'Development mode is active. Use the code below to sign in.',
      code,
      devMode: true
    });
  }

  try {
    await smtpTransport.sendMail({
      from: process.env.SMTP_FROM,
      to: email,
      subject: 'Your STOCKPULSE sign-in code',
      text: `Your STOCKPULSE sign-in code is ${code}. It expires in 10 minutes. If you did not request it, you can ignore this email.`
    });
    return res.status(202).json({ message: 'If this address is approved, a sign-in code will arrive shortly.' });
  } catch (error) {
    console.error('Unable to send sign-in email:', error.message);
    return res.status(502).json({ message: 'We could not send the email right now. Please try again later.' });
  }
}));

app.post('/api/auth/email/verify-code', asyncRoute(async (req, res) => {
  if (!isEmailAuthConfigured()) {
    return res.status(503).json({ message: 'Email sign-in is not configured.' });
  }

  const email = normalizeEmail(req.body && req.body.email);
  const code = String(req.body && req.body.code || '').trim();
  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ message: 'Enter the email address and six-digit code.' });
  }
  if (!devCodeSignInEnabled && !isEmailAllowed(email)) {
    return res.status(401).json({ message: 'The code is invalid or expired. Request a new one.' });
  }

  const now = Date.now();
  const submittedHash = hashEmailCode(email, code);
  const result = await supabaseStore.consumeEmailCode(email, submittedHash, now);
  const valid = Boolean(result && result.valid);

  if (!valid) return res.status(401).json({ message: 'The code is invalid or expired. Request a new one.' });

  const user = await supabaseStore.getOrCreateEmailUser(email, email, roleForEmail(email));

  if (user.totpEnabled && user.totpSecret) {
    req.session.pendingTotpEmail = email;
    return res.json({
      message: 'Google Authenticator verification required.',
      needsTotp: true,
      totpEnabled: true,
      email
    });
  }

  const setupUser = await updateUserTOTP(email, user.totpSecret || generateTOTPSecret(), false);
  const sessionUser = buildSessionUser(setupUser);
  req.session.pendingTotpEmail = email;
  return res.json({
    message: 'Google Authenticator setup required.',
    needsTotp: true,
    totpEnabled: false,
    email,
    setup: {
      secret: setupUser.totpSecret,
      otpauthUri: getTOTPUri(email, setupUser.totpSecret, 'STOCKPULSE'),
      qrCode: await QRCode.toDataURL(getTOTPUri(email, setupUser.totpSecret, 'STOCKPULSE'))
    }
  });
}));

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: 'Logged out.' });
  });
});

app.use('/api', (req, res, next) => {
  if (
    req.path === '/auth/email/request-code' ||
    req.path === '/auth/email/verify-code' ||
    req.path === '/auth/totp/setup' ||
    req.path === '/auth/totp/enable' ||
    req.path === '/auth/totp/verify' ||
    req.path === '/auth/logout' ||
    req.path === '/auth/me' ||
    req.path === '/auth/config'
  ) {
    return next();
  }
  return requireAuth(req, res, next);
});

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function getAccountScope(req) {
  const user = req.session && req.session.user;
  return { userId: user && user.id, isAdmin: Boolean(user && user.role === 'admin') };
}

app.get('/api/portfolio', asyncRoute(async (req, res) => {
  const userId = req.session.user.id;
  if (!userId) return res.status(401).json({ message: 'Your session does not include a user ID.' });
  res.json(await supabaseStore.getPortfolio(userId));
}));

app.post('/api/portfolio', asyncRoute(async (req, res) => {
  const userId = req.session.user.id;
  const body = req.body || {};
  const symbol = String(body.symbol || '').trim();
  const shares = Number(body.shares);
  if (!userId) return res.status(401).json({ message: 'Your session does not include a user ID.' });
  if (!symbol || !Number.isSafeInteger(shares) || shares <= 0) {
    return res.status(400).json({ message: 'Enter a stock symbol and a positive whole number of shares.' });
  }
  res.status(201).json(await supabaseStore.savePortfolio(userId, symbol, shares));
}));

async function readInventoryData(req) {
  const { userId, isAdmin } = getAccountScope(req);
  return supabaseStore.readInventory(userId, isAdmin);
}

app.get('/api/dashboard', asyncRoute(async (req, res) => {
  res.json(getDashboardStats(await readInventoryData(req)));
}));

app.get('/api/analytics/sales', asyncRoute(async (req, res) => {
  const granularity = String(req.query.granularity || 'daily').toLowerCase();
  if (!['daily', 'monthly', 'yearly'].includes(granularity)) {
    return res.status(400).json({ message: 'Granularity must be daily, monthly, or yearly.' });
  }
  const data = await readInventoryData(req);
  return res.json(buildSalesAnalytics(data, granularity));
}));

app.get('/api/products', asyncRoute(async (req, res) => {
  const { userId, isAdmin } = getAccountScope(req);
  res.json(await supabaseStore.listProducts(userId, isAdmin));
}));

app.post('/api/products', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const id = String(body.id || '').trim();
  const category = String(body.category || 'Others').trim();
  const price = Number(body.price || 0);
  const stock = Number(body.stock || 0);
  const sizes = Array.isArray(body.sizes) ? body.sizes : ['S', 'M', 'L', 'XL'];
  const colors = Array.isArray(body.colors) ? body.colors : ['Black', 'White'];

  if (!name) {
    return res.status(400).json({ message: 'Product name is required.' });
  }

  const productId = id || `NEW-${slugifyName(name)}-${Date.now().toString().slice(-4)}`.toUpperCase();
  const newProduct = {
    id: productId,
    name,
    category: category || 'Others',
    emoji: getEmojiForCategory(category || 'Others'),
    price,
    stock,
    sizes,
    colors,
    variants: Array.from({ length: Math.max(1, sizes.length) }, () => Math.max(0, Math.floor(stock / Math.max(1, sizes.length))))
  };

  const { userId, isAdmin } = getAccountScope(req);
  try {
    await supabaseStore.createProduct(userId, newProduct, isAdmin);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'A product with this ID already exists.' });
    }
    throw error;
  }

  res.status(201).json(newProduct);
}));

app.put('/api/products/:id', asyncRoute(async (req, res) => {
  const productId = req.params.id;
  const body = req.body || {};

  const { userId, isAdmin } = getAccountScope(req);
  const updated = await supabaseStore.updateProduct(userId, productId, (product) => {
    const category = String(body.category || product.category || 'Others');
    return {
      name: String(body.name || product.name).trim(),
      category,
      emoji: getEmojiForCategory(category),
      price: Number(body.price ?? product.price),
      stock: Number(body.stock ?? product.stock),
      sizes: Array.isArray(body.sizes) && body.sizes.length ? body.sizes : product.sizes,
      colors: Array.isArray(body.colors) && body.colors.length ? body.colors : product.colors,
      variants: Array.isArray(body.variants) && body.variants.length ? body.variants : product.variants
    };
  }, isAdmin);
  if (!updated) return res.status(404).json({ message: 'Product not found.' });
  return res.json(updated);
}));

app.delete('/api/products/:id', asyncRoute(async (req, res) => {
  const productId = req.params.id;
  const { userId, isAdmin } = getAccountScope(req);
  const deleted = await supabaseStore.deleteProduct(userId, productId, isAdmin);
  if (!deleted) return res.status(404).json({ message: 'Product not found.' });
  return res.json({ message: 'Product deleted.' });
}));

app.get('/api/transactions', asyncRoute(async (req, res) => {
  const { userId, isAdmin } = getAccountScope(req);
  res.json(await supabaseStore.listTransactions(userId, isAdmin));
}));

app.post('/api/transactions', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const productId = String(body.productId || '').trim();
  const type = String(body.type || 'Sale');
  const quantity = Number(body.quantity || 0);

  if (!productId) return res.status(400).json({ message: 'Product is required.' });
  if (quantity <= 0) return res.status(400).json({ message: 'Quantity must be greater than zero.' });
  if (!['Sale', 'Stock In', 'Return'].includes(type)) {
    return res.status(400).json({ message: 'Transaction type is invalid.' });
  }

  const { userId, isAdmin } = getAccountScope(req);
  const product = (await supabaseStore.listProducts(userId, isAdmin)).find((item) => item.id === productId);
  if (!product) return res.status(404).json({ message: 'Product not found.' });
  if (type === 'Sale' && Number(product.stock || 0) < quantity) {
    return res.status(400).json({ message: 'Not enough stock for this sale.' });
  }

  const transaction = {
    id: `TX-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    productId: product.id,
    productName: product.name,
    type,
    quantity,
    amount: type === 'Sale' ? product.price * quantity : 0,
    date: new Date().toISOString()
  };
  const stockDelta = type === 'Sale' ? -quantity : quantity;
  const result = await supabaseStore.createInventoryTransaction(userId, transaction, stockDelta, isAdmin);
  if (result.error) return res.status(result.status).json({ message: result.error });
  return res.status(201).json(result.transaction);
}));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error('Request failed:', error.message);
  res.status(500).json({ message: 'The request could not be completed.' });
});

app.get('/', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  res.sendFile(path.join(__dirname, '.vscode', 'index.html'));
});

app.get('*', (req, res) => {
  const file = req.session && req.session.user
    ? path.join(__dirname, '.vscode', 'index.html')
    : path.join(__dirname, 'public', 'login.html');
  res.sendFile(file);
});

async function startServer() {
  try {
    app.listen(PORT, () => {
      console.log(`STOCKPULSE is running on http://localhost:${PORT}`);
      console.log(`Email sign-in: ${isEmailAuthConfigured() ? 'enabled' : 'not configured'}`);
      console.log('Database: Supabase');
    });
  } catch (error) {
    console.error(`Could not start server on port ${PORT}. Close the process using it or change PORT in .env. Error: ${error.message}`);
    process.exit(1);
  }
}
if (require.main === module) {
  startServer();
} else {
  module.exports = app;
}
