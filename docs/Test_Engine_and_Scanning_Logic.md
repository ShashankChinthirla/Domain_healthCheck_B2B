# ⚙️ Test Engine & Scanning Logic

The `test-engine.ts` is the single most important file in this codebase. It is what actually scans a domain — reaching out to global internet infrastructure to audit security, availability, and reputation.

---

## 1. How a Domain Gets Scanned (The Full Lifecycle)

When you ask the system to scan `example.com`, this is exactly what happens, step by step:

```
┌──────────────────────────────────────────────────────────┐
│                  User / Admin Triggers Scan              │
│         (Clicks "Scan" button OR Rescan All)             │
└───────────────────────────┬──────────────────────────────┘
                            │  POST /api/scan { domain: "example.com" }
                            ▼
┌──────────────────────────────────────────────────────────┐
│                  Input Validation Layer                  │
│  - Strips "http://", "www.", trailing slashes            │
│  - Rejects IPs, localhost, or malformed strings          │
│  - Sanitizes to root domain → "example.com"             │
└───────────────────────────┬──────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────┐
│             Phase 1: DNS Foundation Query                │
│                                                          │
│  dns.promises.resolve4()  →  A Records  (IP Addresses)  │
│  dns.promises.resolveMx() →  MX Records (Mail Servers)  │
│  dns.promises.resolveTxt()→  TXT Records (SPF/DMARC)    │
│                                                          │
│  ⚠️ If Port 53 is blocked:                               │
│    Falls back to DNS-over-HTTPS via Cloudflare 1.1.1.1  │
│    (fetch("https://cloudflare-dns.com/dns-query"))       │
└──────────┬────────────────────────────────────┬──────────┘
           │ IPs found                           │ TXT records found
           ▼                                     ▼
┌──────────────────────┐       ┌─────────────────────────────┐
│  Phase 2A:           │       │  Phase 2B:                  │
│  BLACKLIST CHECK     │       │  EMAIL SECURITY PARSE       │
│                      │       │                             │
│  Reverse "1.2.3.4"  │       │  Find "v=spf1 ..."         │
│  → "4.3.2.1"        │       │  Validate SPF include count │
│                      │       │  Find "v=DMARC1; p=..."    │
│  Query:              │       │  Validate DMARC p= tag      │
│  4.3.2.1.spamhaus.  │       │  Find DKIM keys via         │
│  org via DNS         │       │  common selector probing    │
└──────────────────────┘       └─────────────────────────────┘
           │                                     │
           └────────────────┬────────────────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │    Phase 2C:            │
              │  WEB SERVER CHECK       │
              │                         │
              │  fetch("http://...")    │
              │  fetch("https://...")   │
              │  Read HTTP status code  │
              │  ⏱ Timeout: 5 seconds  │
              │  (AbortController)      │
              └────────────┬────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│              Results Aggregated & Graded                 │
│                                                          │
│   Category          Status     Reason                    │
│  ──────────────────────────────────────────────────────  │
│   DNS Routing     → ✅ Passed   A record found           │
│   SPF             → ❌ Critical  Record missing           │
│   DMARC           → ⚠️  Warning  p=none (no enforcement) │
│   Website HTTP    → ✅ Passed   200 OK                   │
│   Blacklist       → ✅ Passed   Not listed               │
│                                                          │
│   Overall Status: AT RISK                                │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
          ┌─────────────────────────────────┐
          │  Save Result → MongoDB          │
          │  Collection: `issue_domains`    │
          │  Status set: "At Risk"          │
          └─────────────────────────────────┘
```

---

## 2. The Parallel Execution Model (Why It's Fast)

Without parallelism, scanning would be sequential and slow:

```
❌ OLD WAY (Sequential — SLOW)
─────────────────────────────────────────────────────────
[ DNS Lookup ] → 300ms → [ SPF Check ] → 200ms → [ HTTP ] → 400ms → [ Blacklist ] → 300ms
                                                                   Total = 1,200ms ⏳
─────────────────────────────────────────────────────────

✅ NEW WAY (Parallel via Promise.allSettled — FAST)
─────────────────────────────────────────────────────────
Phase 1:  [ DNS Lookup ] → 300ms (must complete first)
          └─────────────────────────────────
Phase 2:  All launched at the exact same time:
          [ SPF Parse  ] ──────── 200ms ──┐
          [ DMARC Parse] ──── 180ms ──────┤
          [ HTTP Check ] ────────────────── 400ms ──┐
          [ Blacklist  ] ──────── 300ms ──┘          │
                                                      │
          Total = 300ms (Phase 1) + 400ms (slowest Phase 2 task)
                = 700ms 🚀   vs 1200ms before
─────────────────────────────────────────────────────────
```

---

## 3. Libraries Used (In Detail)

| Module | Source | Purpose |
|:---|:---|:---|
| `dns/promises` | Native Node.js (no install needed) | Resolves A, MX, TXT, NS records via UDP/TCP |
| `fetch` | Native Node.js 18+ (no install needed) | HTTP/HTTPS web requests & DNS-over-HTTPS fallback |
| `AbortController` | Native (Web API in Node 18+) | Kills hanging connections after 5s timeout |
| Regular Expressions | Native JavaScript | Parsing SPF include chains, DMARC tags |
| `mongoose` | NPM (`npm i mongoose`) | MongoDB object modelling, read/write |
| `crypto` | Native Node.js | AES-GCM 256-bit key encryption & decryption |

---

## 4. The Timeout Protection (AbortController)

Every single outbound network call is wrapped in a 5-second kill switch:

```
  Code starts fetch("https://badserver.com")
         │
         ├──────────────────────────────────────────────┐
         │ Server drips data intentionally              │
         │ (Slowloris Attack)                           │
         │                                              │
         │    ⏱️ 5,000ms passes...                       │
         │                                              │
  AbortController fires .abort()                       │
         │                                              │
  Connection severed at OS level  ◄────────────────────┘
         │
  Result logged → "Status: Timeout / Unreachable"
         │
  Memory freed by Garbage Collector ✅
```

---

## 5. The DNS-over-HTTPS Fallback Diagram

```
         dns.promises.resolve4("example.com")
                    │
         ┌──────────▼──────────┐
         │  Is Port 53 open?   │
         └──────────┬──────────┘
              YES ◄─┤ ►─ NO
               │              │
               ▼              ▼
        Returns IP    fetch("https://cloudflare-dns.com/
         instantly     dns-query?name=example.com&type=A")
                              │
                        Returns IP via
                        HTTPS (Port 443)
                        bypassing firewall ✅
```
