# 🗄️ Database & Collections Guide

This application strictly uses **MongoDB** as its primary database. It does not use SQL or local JSON files.

The application stores data inside a specific database, organized into clearly structured **Collections**.

---

## 🚀 How MongoDB is Connected
When the Next.js server starts, it looks for the `MONGODB_URI` inside your `.env.local` file. 
It establishes a connection using the `mongoose` library located in the `lib/mongodb.ts` file.

---

## 📂 Exact Collections & What They Store

There are **three main collections** you will see if you open MongoDB Compass:

### 1. `issue_domains`
This is the **most important collection in the entire system**. It holds the massive payload of every domain scanned. Every row acts as the "health report" for a specific domain.

**Structure highlights:**
* `domain_name` (String): e.g., "apple.com"
* `status` (String): e.g., "Needs_Scan", "Secure", "At Risk"
* `issues` (Array): A list of human-readable text strings like "Missing SPF Record" or "Blacklisted IP".
* `last_scanned` (Date): The exact UTC timestamp of when the scanner hit the domain.
* `dns_records` (Object): The deeply nested output containing the raw IP address (`A`) and Mail (`MX`) arrays.
* `owner_email` (Optional String): The contact email of the person responsible for the domain.

*How the app uses it:* The `/api/admin/domains` endpoint queries this specific collection to build the massive table on the Admin Dashboard.

---

### 2. `integrations`
This collection securely stores 3rd-party API Keys (specifically, the Cloudflare Sync Token).

**Structure highlights:**
* `service` (String): e.g., "Cloudflare"
* `apiKey` (String): **Warning!** This string is stored militarily encrypted (AES-GCM 256-bit). If you read this directly in MongoDB, it looks like `v1:base64gibberish`.
* `iv` (String): The cryptographic salt used to decipher the key.

*How the app uses it:* When an Admin clicks "Sync Cloudflare", the system queries this collection, decrypts the token on-the-fly, and uses it to download the company fleet.

---

### 3. `user_settings`
This collection stores the customized preferences for each individual Administrator.

**Structure highlights:**
* `user_email` (String): e.g., "admin@company.com"
* `outreach_template` (String): The default "Hey, your server is broken" text the admin saved.
* `email_client` (String): What the admin prefers clicking on (e.g., "gmail" vs "outlook").

*How the app uses it:* When an admin opens up the `/settings` page, the system searches this collection for their exact Firebase email to pre-fill their saved inputs.
