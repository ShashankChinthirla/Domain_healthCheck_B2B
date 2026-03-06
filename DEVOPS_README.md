# B2B Domain Healthcheck Standalone Server

This is the fully standalone B2B version of the Domain Healthcheck application.
It contains both the frontend/backend Next.js web application and the autonomous Cron Job scheduler (replacing GitHub Actions).

## System Requirements
- Node.js (v20+ recommended)
- NPM
- External MongoDB Database

---

## 🔐 Required Environment Variables
You MUST set the following environment variables on your server or Docker container before running the application.

```env
# Database & Encryption
MONGODB_URI="your_production_mongodb_connection_string"
ENCRYPTION_KEY="your_secure_32_character_encryption_key"

# External Services
CLOUDFLARE_API_TOKEN="master_cloudflare_api_token"
RESEND_API_KEY="your_resend_api_key_for_emails"
GITHUB_PAT="optional_github_classic_token_for_internal_syncs"

# Firebase (Frontend Auth)
NEXT_PUBLIC_FIREBASE_API_KEY="..."
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="..."
NEXT_PUBLIC_FIREBASE_PROJECT_ID="..."
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="..."
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="..."
NEXT_PUBLIC_FIREBASE_APP_ID="..."
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID="..."
```

---

## 🚀 Deployment Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Build the Next.js Application
```bash
npm run build
```

### 3. Start the Web Server
We recommend using [PM2](https://pm2.keymetrics.io/) to keep the server alive in production.
```bash
npm run start
# OR using PM2:
# pm2 start npm --name "domain-web" -- start
```

### 4. Start the Background Cron Scheduler
This repository includes a native Node.js cron scheduler (`cron-server.js`) that completely replaces the old GitHub Actions workflows. It runs the daily domain syncs and 10-day rescans automatically.

You MUST run this alongside the web server in the background.

```bash
node cron-server.js
# OR using PM2:
# pm2 start cron-server.js --name "domain-cron"
```
