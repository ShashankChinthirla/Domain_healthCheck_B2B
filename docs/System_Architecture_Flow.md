# ⚙️ System Architecture & Workflow

This document explains exactly how data moves through the application, from the moment a user clicks a button to the moment it saves into MongoDB.

---

## 1. The Core Application Flow

1. **The User Interface (React/Next.js)**
   An admin navigates to the dashboard and enters a domain (or clicks "Rescan All"). The browser packages the request and sends a standard `POST` HTTP request.
   
2. **The API Entry Point (`/api/scan`)**
   The Next.js backend server receives the request. It validates the domain name (stripping off `http://` or spaces), and immediately hands it to the testing engine.

3. **The Testing Engine (`test-engine.ts`)**
   This is where the magic happens. The engine uses `Promise.all` to launch 4 things *at the exact same time*:
   * **DNS Lookup**: Pings the web nameservers to ask "What is the IP address?"
   * **Email Security**: Fetches all TXT records to look for SPF, DKIM, and DMARC rules.
   * **Web Server Ping**: Fires a web request to `https://domain.com` to see if the server replies with `200 OK`.
   * **Blacklist Check**: Reverses the IP address and checks global Spamhaus databases to ensure the domain isn't banned.

4. **Aggregation & Scoring**
   Once all tests finish, the system scores the domain. Does it lack DMARC? The system labels it "At Risk". 

5. **Saving to MongoDB**
   The massive organized JSON object is then updated or inserted into the `issue_domains` MongoDB Collection so the admin can review the history later.

---

## 2. The File Structure Map

If you need to edit code, here is exactly where everything lives:

* **`/app/`**: All the React Frontend pages (e.g., `/app/admin/page.tsx` is the Admin Dashboard UI).
* **`/app/api/`**: The Backend Server paths. If you want to change how the system fetches a domain, you edit the files in here.
* **`/lib/test-engine.ts`**: The core brain containing all the DNS/HTTP/Blacklist testing logic.
* **`/lib/mongodb.ts`**: The code that actually dials and connects to the MongoDB server.
* **`/lib/encryption.ts`**: The system that encrypts Cloudflare keys before saving them to the database.

---

## 3. How the Cloudflare Sync Works natively
Instead of manually typing domains, the system offers an automated Sync script.

1. The Admin inputs an API key in the `/settings` UI.
2. The UI sends the key to the `/api/settings` route, where it encrypts the key and saves it to the `integrations` MongoDB collection.
3. The Admin clicks **"Sync Cloudflare"**.
4. The backend grabs the encrypted key from MongoDB, decrypts it, and reaches out to `https://api.cloudflare.com`.
5. Cloudflare returns the raw domain list (e.g., thousands of domains).
6. The Backend executes a massive `bulkWrite` into the `issue_domains` MongoDB collection, adding any domain it doesn't recognize with a status of `Needs_Scan`.
