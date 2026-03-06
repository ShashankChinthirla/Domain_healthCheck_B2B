# ⚡ System Architecture & Data Flow

This document illustrates how every component in the Domain Health Checker B2B Edition connects, communicates, and operates together on a company server.

---

## 1. Top-Level Architecture

```
                     ┌──────────────────────────────────┐
                     │      Admin Web Browser           │
                     │  (React / Next.js UI Dashboard)  │
                     └─────────────┬────────────────────┘
                                   │  HTTPS Requests
                                   ▼
                     ┌──────────────────────────────────┐
                     │    Next.js Application Server    │
                     │       (Running via PM2)          │
                     │                                  │
                     │  ┌──────────┐  ┌──────────────┐  │
                     │  │  /pages  │  │  /api routes │  │
                     │  │ (React   │  │  (Backend    │  │
                     │  │  UI)     │  │   Logic)     │  │
                     │  └──────────┘  └──────┬───────┘  │
                     └─────────────────────── │ ─────────┘
                                              │
               ┌──────────────────────────────▼──────────────────────────┐
               │                   Core Services Layer                   │
               │                                                         │
               │  ┌──────────────────┐   ┌──────────────────────────┐   │
               │  │  test-engine.ts  │   │     lib/mongodb.ts        │   │
               │  │  (DNS / HTTP /   │   │  (Persistent Connection   │   │
               │  │   Blacklist /    │   │   to MongoDB Cluster)     │   │
               │  │   SPF/DMARC)     │   └────────────┬─────────────┘   │
               │  └────────┬─────────┘                │                  │
               └───────────│──────────────────────────│──────────────────┘
                           │                          │
               ┌───────────▼───────────┐   ┌──────────▼──────────────────┐
               │   External Internet   │   │        MongoDB Atlas         │
               │                       │   │                             │
               │  - DNS Resolvers      │   │  ┌────────────────────────┐ │
               │  - Spamhaus DNSBL     │   │  │  issue_domains         │ │
               │  - Target Webservers  │   │  │  integrations          │ │
               │  - Cloudflare API     │   │  │  user_settings         │ │
               └───────────────────────┘   │  └────────────────────────┘ │
                                           └─────────────────────────────┘
```

---

## 2. The Cloudflare Auto-Sync Flow

```
Admin clicks "Sync Cloudflare" button
              │
              ▼
   POST /api/sync-cloudflare
              │
    ┌─────────▼─────────────────────────────────────────┐
    │  1. Fetch encrypted key from MongoDB               │
    │     Collection: `integrations`                     │
    │     Field: apiKey (stored as "v1:base64encrypted") │
    └─────────┬─────────────────────────────────────────┘
              │
    ┌─────────▼─────────────────────────────────────────┐
    │  2. Decrypt key using lib/encryption.ts            │
    │     AES-GCM 256-bit → raw Cloudflare API Token     │
    └─────────┬─────────────────────────────────────────┘
              │
    ┌─────────▼─────────────────────────────────────────┐
    │  3. Call Cloudflare API                            │
    │     GET api.cloudflare.com/client/v4/zones         │
    │     Response: List of 1,000s of owned domains      │
    └─────────┬─────────────────────────────────────────┘
              │
    ┌─────────▼─────────────────────────────────────────┐
    │  4. Compare vs existing MongoDB domains            │
    │     Query: { $in: [ ...incomingDomains ] }         │
    │     Result: Identify new domains not in DB yet     │
    └─────────┬─────────────────────────────────────────┘
              │
    ┌─────────▼─────────────────────────────────────────┐
    │  5. BulkWrite new domains to MongoDB               │
    │     Collection: `issue_domains`                    │
    │     Status set to: "Needs_Scan"                    │
    │     (They will be scanned on next cron cycle)      │
    └────────────────────────────────────────────────────┘
              │
              ▼
    ✅ Toast notification shown to Admin:
       "Synced 423 new domains. 0 duplicates skipped."
```

---

## 3. The Cron Scan Loop (How Bulk Scanning Happens)

Instead of GitHub Actions (cloud-only), this B2B version uses a **locally running Node.js cron worker** via the `scripts/` folder.

```
 Every N minutes (configured in scripts/cron.ts)
              │
              ▼
    ┌──────────────────────────────────────────────┐
    │  Query MongoDB for pending domains           │
    │  db.issue_domains.find({ status: "Needs_Scan" })  │
    └─────────────┬────────────────────────────────┘
                  │
                  │  Chunked into batches of 50
                  ▼
    ┌──────────────────────────────────────────────┐
    │  Feed each batch to test-engine.ts           │
    │  (Parallel Promise.allSettled execution)     │
    └─────────────┬────────────────────────────────┘
                  │
                  ▼
    ┌──────────────────────────────────────────────┐
    │  Write results back to MongoDB               │
    │  Update document: status, issues, dns_records│
    │  Set: last_scanned = new Date()              │
    └──────────────────────────────────────────────┘
                  │
                  ▼
    Admin dashboard auto-refreshes to show results ✅
```

---

## 4. Request / Response Lifecycle (Single Scan)

```
Time →  0ms      300ms        700ms        1000ms
        │         │            │             │
Browser │──POST──►│            │             │
API     │         │──Phase1──► │             │
DNS     │         │  A/MX/TXT  │             │
        │         │◄───────────│             │
API     │         │──Phase2─────────────────►│
        │         │  SPF+HTTP+Blacklist (parallel)
        │         │◄─────────────────────────│
API     │◄──JSON──│  Aggregated results back │
Browser │ Renders │            │             │
        │ cards   │            │             │
```
