# Full Backend API Documentation & Network Control

The backend runs on **Next.js 14 API Routes**. It is entirely stateless, parallel-optimized, and integrates natively with MongoDB and Cloudflare integrations.

This document breaks down how complex tasks like "Sync and Scan" run massively concurrently without memory leaks.

---

## 1. Overview of Primary Routes
1. `/api/scan` - Analyzes a single, specific HTTP string entirely sync. Returns intense deep-dive results.
2. `/api/sync-cloudflare` - Authenticates encrypted keys, batches 3rd party domains directly into internal DB models.
3. `/api/remediate` - Provides bulk fixes to mass domains that are internally flagged `Needs_Scan`.
4. `/api/admin/domains` - Provides cursor-pagination of raw MongoDB data specifically for massive Table generation on the Dashboard.

---

## 2. Cloudflare Fleet Loading (`api/sync-cloudflare`)
When an Admin requests a full Fleet connection, the API initiates a heavily controlled workflow:
1. **Key Fetch:** Looks inside the `integrations` MongoDB collection to find the Active Cloudflare API token.
2. **Key Decryption:** It runs the AES-GCM decryption sub-routines (as documented in `Encryption_and_Security.md`) directly against the buffer salts. 
3. **Cloudflare Pagination HTTP:** It polls `https://api.cloudflare.com/client/v4/zones?per_page=1000`. 
4. **Normalization Check:** It validates the domains, ensures Cloudflare reported them as `active`, and cleans strings (stripping off `.com` fragments or parsing subdomains strictly to root hostnames).
5. **DB Check:** It runs massive `{ $in: domainBatches }` array sweeps against the MongoDB `issue_domains` collection to see what domains the business ALREADY knows.
6. **Parallel Upsert:** Instead of slowly looping `.insert()` 5,000 times, it pushes a `bulkWrite` operation injecting brand new records specifically tagged `Needs_Scan` into the DB.

---

## 3. Automation Engine (Bulk Remediates / Parallelization)
Normally, testing 10,000 domains takes hours due to explicit DNS socket hanging. 
The system combats this with distinct asynchronous boundaries.

### 3.1 Fetch Control (Abort Controllers)
Every time the engine tests a domain `fetch()`, it attaches an aggressive `AbortSignal.timeout(2500)`. If a domain takes longer than 2.5s, the system instantly throws an `AbortError`, marking it `Unresponsive`, and aggressively closing the open memory socket.

### 3.2 Promise Handling (`test-engine.ts`)
The true magic lives inside `Promise.allSettled`. 
If a user hits "Rescan All", the backend creates an execution queue pool matching physical CPU cores.
It runs SPF Validation, DMARC formatting, Web Accessibility, and Blacklist Checks **SIMULTANEOUSLY**.

* It does not wait for a Blacklist API response before checking HTTP availability.
* It uses Cloudflare (`1.1.1.1`) and Google (`8.8.8.8`) DoH (DNS Over HTTPS) fallback nodes cleanly if typical `dns.resolveTxt` methods return timeout exceptions (avoiding strict corporate network firewall rules locking Port 53 UDP).

### 3.3 Rate Limiting
APIs checking blacklists strictly cap the `fetch` concurrency. Rather than hammering a list API 10,000 times a minute and getting IP banned manually, the code specifically loops domains using an exponential backoff timing algorithm or explicitly separates checks by 500ms intervals natively to remain within rate-limits.
