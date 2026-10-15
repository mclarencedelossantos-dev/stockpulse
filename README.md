# STOCKPULSE

STOCKPULSE is a full‑stack inventory and sales management web application built with Node.js, Express, and Supabase. It provides secure email‑based login (with optional TOTP), product inventory tracking, transaction recording, analytics, and a responsive dashboard.

## Features

- **Authentication**
  - Email‑based sign‑in code (6‑digit) via Resend SMTP
  - Optional Google Authenticator TOTP for second‑factor verification
  - Session management with Supabase‑backed store
- **Inventory Management**
  - Add, edit, delete products
  - Track stock levels
  - Record stock‑in, sales, and return transactions
- **Sales & Analytics**
  - Daily / monthly / yearly sales charts (revenue & units)
  - Product movement classification (Fast, Moderate, Slow, Non‑moving)
  - Top‑selling products by units and revenue
  - Monthly revenue and units sold summary cards
- **Responsive UI**
  - Mobile‑friendly layout
  - Sidebar navigation
  - Card‑based product list with spacing and hover effects
- **Extensible**
  - Easy to add new reports or modify existing logic
  - Environment‑driven configuration (SMTP, Supabase, ports, secrets)

## Tech Stack

- **Backend**: Node.js, Express
- **Database**: Supabase (PostgreSQL) with custom stored procedures and RPC functions
- **Authentication**: Custom email code + TOTP (otplib)
- **Email**: Resend SMTP (via Nodemailer)
- **Frontend**: Plain HTML/CSS/JS (no framework) – served as static files
- **Styling**: CSS variables, responsive design
- **Testing**: Jest (placeholder test file)

## Project Structure

```
STOCKPULSE/
├── .vscode/               # Workspace settings (optional)
│   ├── index.html         # Main SPA (served when logged in)
│   ├── script.js          # Client‑side logic
│   └── style.css          # Styling
├── public/
│   └── login.html         # Login page (shown when not authenticated)
├── auth-check.js          # Middleware to protect routes
├── server.js              # Express app entry point
├── supabase-store.js      # Supabase data access layer
├── supabase/
│   └── schema.sql         # Database schema & stored procedures
├── tests/
│   └── sales-analytics.test.js   # Example test
├── .gitignore             # Files/folders to ignore in Git
├── package.json           # NPM dependencies & scripts
└── README.md              # This file
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (>= 18 recommended)
- A [Supabase](https://supabase.io/) project with the schema applied
- A [Resend](https://resend.com/) account (for email sending)
- Git (optional, for version control)

### 1. Clone the repository (or copy the files)

```bash
git clone https://github.com/yourusername/stockpulse.git
cd stockpulse
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root (copy the example below) and fill in your values:

```env
PORT=3000

SESSION_SECRET=change-this-to-a-long-random-string   # 32+ hex characters
OTP_SECRET=change-this-to-another-long-random-string

EMAIL_DEV_MODE=false          # Set true for local testing (logs code to console)
OPEN_EMAIL_SIGNUP=true        # Allow anyone to request a sign‑in code

# Resend SMTP settings
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=resend
SMTP_PASS=re_XXXXXXXXXXXXXXXXXXXXXXXX   # Your Resend SMTP API key
SMTP_FROM="STOCKPULSE <you@yourverifieddomain.com>"   # Must be a verified domain

# Supabase connection
SUPABASE_URL=https://yourproject.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_PUBLISHABLE_KEY=your_anon_key
SUPABASE_JWKS_URL=https://yourproject.supabase.co/auth/v1/.well-known/jwks.json
```

> **Note**:  
> - For local testing you may set `EMAIL_DEV_MODE=true`. The app will then log the 6‑digit code to the console instead of sending an email.  
> - `SMTP_FROM` must use an address from a domain you have verified in Resend (see the *Email Setup* section below).

### 4. Set up the Supabase database

1. Create a new Supabase project (or use an existing one).  
2. In the Supabase dashboard, go to **SQL Editor** and paste the contents of `supabase/schema.sql`.  
3. Click **Run** to create the tables, stored procedures, and default data.

### 5. Start the server

```bash
npm start
```

You should see output similar to:

```
STOCKPULSE is running on http://localhost:3000
Email sign-in: enabled
Database: Supabase
```

### 6. Use the application

- Open your browser to `http://localhost:3000`.
- You will be redirected to the login page (`/login`).
- Enter any email address (e.g., `test@example.com`) and click **Send sign‑in code**.
  - If `EMAIL_DEV_MODE=true`, the code will appear in the server console (look for `[DEV EMAIL CODE]`).
  - If `EMAIL_DEV_MODE=false`, a real email will be sent via Resend to the address you entered.
- Enter the 6‑digit code you received.
- If TOTP is enabled (default), you will be prompted to set up Google Authenticator:
  - Scan the QR code with an authenticator app (Google Authenticator, Authy, etc.).
  - Enter the 6‑digit code from the app and click **Enable Google Authenticator**.
- You are now logged in and see the dashboard.
- Navigate via the sidebar to **Products**, **Transactions**, **Analytics**, etc.

## Email Setup (for production)

To send real sign‑in emails you must verify a domain in Resend.

1. Sign in to [Resend](https://resend.com/).
2. Go to **Domains → Add Domain**.
3. Enter a domain you own (or get a free one from [Freenom](https://www.freenom.com) – e.g., `.tk`, `.ml`, `.ga`, `.cf`, `.gq`).
4. Resend will provide a **TXT record** (name/host and value).
5. Add that TXT record in your DNS manager (Freenom’s *Manage Freenom DNS*, Cloudflare, your registrar, etc.).
6. Wait a minute or two, then click **Verify** in Resend. When the status shows **Verified**, you can use any address `@yourdomain.com` as the sender.
7. Update `.env` (or your deployment environment variables) with:
   ```env
   SMTP_FROM="STOCKPULSE <you@yourverifieddomain.com>"
   ```
8. Ensure `EMAIL_DEV_MODE=false` and redeploy/restart.

## Deployment

The app is a standard Node/Express service and can be deployed to any platform that supports Node.js (Render, Railway, Fly.io, Azure App Service, Google Cloud Run, etc.).

### Example: Render.com

1. Push the code to a GitHub repository (see below).
2. In Render, click **New → Web Service**.
3. Connect your GitHub account and select the repo.
4. Set:
   - **Build Command**: (leave blank – no build step)
   - **Start Command**: `npm start`
   - **Environment**: Node (choose the version you used locally)
5. Under **Environment**, add the same variables from your `.env` (do **not** commit `.env` to GitHub).
6. Click **Create Web Service**. Render will build and deploy the service.
7. Once deployed, visit the provided URL and test the login flow.

### GitHub – Pushing the code

If you haven’t already pushed the project to GitHub:

```bash
# Ensure you are in the project root
git init
git add .
git commit -m "Initial commit – STOCKPULSE project"
git remote add origin https://github.com/yourusername/stockpulse.git
git branch -M main
git push -u origin main
```

Your `.gitignore` already excludes `node_modules`, `.env`, logs, IDE folders, etc., so only source code is uploaded.

## Testing

A basic Jest test file exists at `tests/sales-analytics.test.js`. To run tests:

```bash
npm test
```

(You may need to add a `"test": "jest"` script to `package.json` if not present.)

## License

This project is provided as‑is. Feel free to adapt and use it according to your needs.

## Acknowledgments

- [Supabase](https://supabase.io/) for the backend database and auth helpers.
- [Resend](https://resend.com/) for reliable transactional email.
- [otplib](https://github.com/otplib/otplib) for TOTP generation and verification.
- The open‑source community for various npm packages used.

--- 

*Happy tracking!* 