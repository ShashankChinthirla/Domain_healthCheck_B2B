# 💻 B2B Server Setup Guide

This guide walks through exactly how to get the application permanently running on a **company Linux server** using PM2.

---

## 1. Server Requirements

```
┌─────────────────────────────────────────────────────────┐
│             Minimum Server Specifications               │
├─────────────────────────┬───────────────────────────────┤
│  Operating System       │  Ubuntu 20.04+ / Debian 11+   │
│  Node.js Version        │  18.x or higher               │
│  RAM                    │  1 GB minimum (2 GB ideal)     │
│  Disk Space             │  500 MB free                  │
│  MongoDB                │  Atlas cluster OR local Mongo  │
│  Network Access         │  Outbound Port 443 (HTTPS)     │
└─────────────────────────┴───────────────────────────────┘
```

---

## 2. Step-by-Step Deployment

### Step 1: Install Node.js & PM2
```bash
# Update packages
sudo apt update && sudo apt upgrade -y

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally
sudo npm install -g pm2

# Verify installations
node -v    # Should show v18.x.x
pm2 -v     # Should show a version number
```

### Step 2: Clone the Project
```bash
git clone https://github.com/ShashankChinthirla/Domain_healthCheck_B2B.git
cd Domain_healthCheck_B2B
npm install
```

### Step 3: Configure Environment Variables

Create a `.env.local` file. The app **will not start** without these:

```env
# ─── MongoDB ──────────────────────────────────────────────
MONGODB_URI="mongodb+srv://USERNAME:PASSWORD@cluster0.abcde.mongodb.net/domain_health"

# ─── Encryption ───────────────────────────────────────────
# Generate a random 32-character string and NEVER lose it
ENCRYPTION_KEY="a8f3kD92mQpL5tZwYc7vRnXjUe6bOsHi"

# ─── Firebase Auth ────────────────────────────────────────
NEXT_PUBLIC_FIREBASE_API_KEY="AIzaSy..."
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="yourapp.firebaseapp.com"
NEXT_PUBLIC_FIREBASE_PROJECT_ID="yourapp"
```

### Step 4: Build & Launch

```bash
# Compile the Next.js production build
npm run build

# Start the app as a background service using PM2
pm2 start npm --name "DomainScanner-B2B" -- start

# Auto-restart on server reboot
pm2 save
pm2 startup
```

---

## 3. Deployment Lifecycle Diagram

```
Developer pushes code update to GitHub
                │
                ▼
  SSH into the company Linux server
                │
                ▼
  cd Domain_healthCheck_B2B
  git pull origin main          ← Pull latest updates
                │
                ▼
  npm install                   ← Install any new dependencies
                │
                ▼
  npm run build                 ← Recompile TypeScript → JS
                │
                ▼
  pm2 restart DomainScanner-B2B ← Zero-downtime hot reload
                │
                ▼
  Application is live at localhost:3000 ✅
```

---

## 4. Optional: NGINX Reverse Proxy

If you want to access the app from the browser using your company domain (e.g., `scanner.company.com`) instead of typing `server-ip:3000`:

```bash
# Install NGINX
sudo apt install nginx -y

# Create a site config
sudo nano /etc/nginx/sites-available/domain_scanner
```

Paste this config:
```nginx
server {
    listen 80;
    server_name scanner.company.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Enable the site and reload NGINX
sudo ln -s /etc/nginx/sites-available/domain_scanner /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 5. PM2 Cheat Sheet

| Command | Description |
|:---|:---|
| `pm2 list` | See all running processes |
| `pm2 logs DomainScanner-B2B` | View live application logs |
| `pm2 restart DomainScanner-B2B` | Restart the app (after code changes) |
| `pm2 stop DomainScanner-B2B` | Temporarily stop the service |
| `pm2 delete DomainScanner-B2B` | Permanently remove the service |
