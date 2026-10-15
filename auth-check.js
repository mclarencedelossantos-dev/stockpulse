const http = require('http');

function request(path, method = 'GET', body = null, cookie = '') {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    if (data) headers['Content-Length'] = data.length;

    const req = http.request(
      {
        hostname: 'localhost',
        port: 3000,
        path,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const bodyText = Buffer.concat(chunks).toString('utf8');
          resolve({ statusCode: res.statusCode, headers: res.headers, body: bodyText });
        });
      }
    );

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  const unauth = await request('/api/dashboard');
  console.log('UNAUTH_STATUS', unauth.statusCode);

  const authConfig = await request('/api/auth/config');
  const config = JSON.parse(authConfig.body);
  console.log('EMAIL_SIGN_IN_ENABLED', config.emailEnabled);

  const passwordLogin = await request('/api/auth/login', 'POST', JSON.stringify({ username: 'admin', password: 'admin123' }));
  console.log('LEGACY_PASSWORD_LOGIN_STATUS', passwordLogin.statusCode);

  if (!config.emailEnabled) {
    const requestCode = await request('/api/auth/email/request-code', 'POST', JSON.stringify({ email: 'test@example.com' }));
    console.log('MISSING_EMAIL_CONFIG_STATUS', requestCode.statusCode);
  }

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);



})();
