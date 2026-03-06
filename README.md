# 🩺 Domain & Email Health Checker (B2B Edition)

A powerful, automated tool that scans thousands of company domains instantly to find broken configurations, missing SPF/DMARC records, or blacklisted IP addresses. 

This repository is strictly configured for **Internal Corporate Server Deployment (Linux/PM2)**.

---

## 🚀 How It Works

This application is built tightly around a stateless API and a **MongoDB Database**. It performs mass network polling independently of external browser constraints.

1. **The Admin Adds Domains:** You paste domains into the UI dashboard or use the "Sync Cloudflare" button.
2. **The Scanner Runs Parallel Tests:** Node.js hits the network to discover IP Addresses, Emails Servers (MX), Web Accessibility (HTTP 200), and Spamhaus Blacklist status. 
3. **Data is Stored in MongoDB:** The results are mapped securely into explicit Database Collections.
4. **The Dashboard Updates:** The React Frontend pulls the formatted MongoDB data to show a beautiful Red/Green status board.

---

## 🗄️ Understanding The Database (MongoDB)
This project **requires** MongoDB to operate. All data, settings, and health checks are stored across 3 main collections.

### The 3 Core Collections:
*   `issue_domains` **(The Most Important)**: This table holds the actual health reports. Every time a domain is scanned, its exact status (`Secure`, `At Risk`, `Needs_Scan`) and the raw DNS data are saved into a document inside this collection.
*   `user_settings`: Saves personalized preferences for your Administrators (e.g. customized Outreach Email Templates or Dashboard display names).
*   `integrations`: Securely stores AES-GCM 256-bit encrypted API tokens from 3rd party services like Cloudflare so the system can automatically download your company's domain list seamlessly.

> For a complete, deep-dive into exactly how the schemas are formatted, please read the [Database & Collections Guide](docs/Database_and_Collections.md).

---

## 📚 Complete Documentation

Before starting the server, please read the dedicated documentation in the `/docs` folder. It is written to be extremely simple and structured.

1.  **[Database & Collections](docs/Database_and_Collections.md)** - A complete layout of the MongoDB tables.
2.  **[System Architecture Flow](docs/System_Architecture_Flow.md)** - Explains exactly how the React Frontend and Node Backend communicate with Cloudflare.
3.  **[Test Engine & Scanning Logic](docs/Test_Engine_and_Scanning_Logic.md)** - Detailed dive into the `test-engine.ts` Async Parallelism, dependencies (Native Node.js `dns`, `fetch`), and exact scan mechanics.
4.  **[B2B Server Setup Guide](docs/B2B_Server_Setup.md)** - The exact step-by-step terminal commands required to launch this on an Ubuntu Linux server using PM2.

---

## ⚡ Quick Start (Local Run)

If you want to run this on your laptop before moving it to the Server:

1. **Clone & Install**
   ```bash
   git clone https://github.com/ShashankChinthirla/Domain_healthCheck_B2B.git
   cd Domain_healthCheck_B2B
   npm install
   ```
2. **Set your Variables**
   Create a `.env.local` file containing your MongoDB URI and a random 32-character Encryption password.
   ```env
   MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/database"
   ENCRYPTION_KEY="12345678901234567890123456789012"
   ```
3. **Run normally**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your browser.
