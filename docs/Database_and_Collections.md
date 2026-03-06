# 🗄️ Database & Collections Guide

This application uses **MongoDB** as its exclusive data store. Every domain, scan result, admin setting, and encrypted API key is persisted to one of three collections.

---

## 1. Database Connection Overview

```
   Next.js Application
          │
          │  (lib/mongodb.ts)
          │  Uses: mongoose.connect(MONGODB_URI)
          ▼
   ┌───────────────────────┐
   │     MongoDB Atlas      │
   │   (or local MongoDB)  │
   │                       │
   │  Database: "domain_health"  │
   │  ┌────────────────────┐│
   │  │  issue_domains     ││──── Primary scan data
   │  ├────────────────────┤│
   │  │  integrations      ││──── Encrypted API keys
   │  ├────────────────────┤│
   │  │  user_settings     ││──── Admin preferences
   │  └────────────────────┘│
   └───────────────────────┘
```

---

## 2. Collection 1: `issue_domains` ⭐ Most Important

This is the core table. Every domain the system knows about lives here. Every scan result is written here.

### Document Schema (What a Single Record Looks Like)
```json
{
  "_id": "ObjectId('...')",
  "domain_name": "example.com",
  "status": "At Risk",
  "last_scanned": "2024-10-27T12:00:00.000Z",
  "owner_email": "admin@example.com",
  "issues": [
    "Missing DMARC Record",
    "SPF uses +all (Dangerous)"
  ],
  "dns_records": {
    "a_records": ["93.184.216.34"],
    "mx_records": ["mail.example.com"],
    "spf_raw": "v=spf1 include:google.com +all"
  },
  "web_check": {
    "http_status": 200,
    "https_status": 200,
    "latency_ms": 243
  },
  "blacklist": {
    "listed": false,
    "blacklists_checked": ["zen.spamhaus.org", "b.barracudacentral.org"]
  }
}
```

### Status Values (State Machine)
```
  Needs_Scan ──► (Scanner runs) ──► Secure
                                 └──► At Risk
                                 └──► Unresponsive
```

### Queried by:
* `/api/admin/domains` → Paginates this collection to render the Admin dashboard table.
* `scripts/cron.ts` → Finds all `{ status: "Needs_Scan" }` Documents to kick off bulk scanning.

---

## 3. Collection 2: `integrations`

Stores encrypted 3rd-party API keys so the system can sync domains automatically via Cloudflare.

### Document Schema
```json
{
  "_id": "ObjectId('...')",
  "service": "Cloudflare",
  "label": "My Company Account",
  "apiKey": "v1:Kx2mQ9...base64encryptedtoken...==",
  "iv": "randombase64ivstring=="
}
```

### How Encryption Works (Visual)
```
Admin types raw key: "abc123secrettoken"
           │
           ▼ lib/encryption.ts (AES-GCM 256)
           │  1. Generate random IV (Salt)
           │  2. Encrypt using ENCRYPTION_KEY from .env.local
           │  3. Prefix result with "v1:"
           ▼
Stored in MongoDB: "v1:Kx2mQ9...ciphertext...=="
           │
           │  (When needed for Cloudflare Sync)
           ▼
           Decrypt ← Using same ENCRYPTION_KEY + stored IV
           Raw token restored → sent to Cloudflare API
```
> ⚠️ **Critical:** If you change `ENCRYPTION_KEY` in your `.env.local`, ALL previously stored keys in this collection become permanently unreadable. Store the key safely.

---

## 4. Collection 3: `user_settings`

Stores per-admin customizations for how they interact with the dashboard and Outreach emails.

### Document Schema
```json
{
  "_id": "ObjectId('...')",
  "user_email": "john@company.com",
  "display_name": "John Smith – IT Lead",
  "email_client": "gmail",
  "outreach_template": "Hello, we noticed an issue with your domain configuration...",
  "signature": "John Smith | IT Security | +1-555-0100"
}
```

### How This Flows into the Outreach Feature
```
Admin notices domain "badactor.com" has no DMARC
                    │
  Admin clicks the Email icon on the domain row
                    │
  System queries user_settings for admin's email
                    │
  Builds mailto: URL using saved template + signature
                    │
  Opens Gmail (or Outlook) pre-filled with the message ✅
```
