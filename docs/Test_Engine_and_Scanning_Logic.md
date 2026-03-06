# ⚙️ Test Engine & Scanning Logic

This document details the exact technical mechanics of **how a domain is scanned**, the libraries involved, and how the results are aggregated inside the core `test-engine.ts` module.

---

## 1. The Core Approach: Asynchronous Parallelism

When you type a domain into the scanner, the system **does not** check things one by one (e.g., waiting for DNS, then waiting for Email checks, then waiting for Website checks). That would be extremely slow.

Instead, the `test-engine.ts` uses an architecture called **Asynchronous Parallelism**. It fires off almost all network requests at the exact same moment.

### The Two-Phase Execution

A scan operates in two distinct phases to ensure speed without breaking dependencies:

**Phase 1: Foundation (IP Address & Mail Servers)**
* The engine first asks the global internet: *"What is the IP Address (`A` record) and Mail Server (`MX` record) for this domain?"*
* This phase must finish first because Phase 2 needs the IP address.

**Phase 2: The Parallel Blast**
* The moment Phase 1 returns the IP address, the engine uses JavaScript's `Promise.allSettled([])` feature to launch the remaining tests simultaneously:
  1. The **HTTP Crawler** connects to the web server.
  2. The **Email Security Module** parses SPF, DKIM, and DMARC TXT strings.
  3. The **Blacklist Module** reverses the IP address and checks Spamhaus.

*Because they run at the same time, a scan takes only as long as the single slowest test, not the sum of all tests.*

---

## 2. The Libraries & Technology Used

The backend was built to be extremely lightweight, avoiding heavy, bloated third-party NPM packages whenever possible. It relies almost entirely on the **Native Node.js Standard Library**.

### 📡 DNS Lookups
* **Library:** `node:dns/promises` (Native Node.js)
* **How it works:** This is the core engine for resolving `A`, `MX`, and `TXT` records. It opens direct UDP Port 53 sockets to standard OS nameservers or custom ones (like Google's `8.8.8.8`).
* **Fallback:** If a strict corporate firewall blocks Port 53, the system catches the error and falls back to a custom **DNS-over-HTTPS (DoH)** implementation using native `fetch()`, securely routing the DNS question over standard web traffic (Port 443 TCP) to Cloudflare.

### 🌐 Web Server Accessibility
* **Library:** Native `fetch` API (Built into Node 18+)
* **How it works:** The engine sends `fetch("http://domain.com")` and `fetch("https://domain.com")`. It checks the HTTP status codes (e.g., `200 OK`, `301 Redirect`, `403 Forbidden`). 
* **Protection:** It uses an `AbortController`. If a severely broken server traps the connection, the controller aggressively severs the socket exactly at the 5-second mark to prevent server memory crashes (`Slowloris` attacks).

### 🛡️ Blacklist Lookups
* **Protocol:** DNSBL (DNS-based Blackhole List)
* **How it works:** It requires no external APIs or paid HTTP services. It uses native `dns.promises.resolve4()`. If the domain's IP is `12.34.56.78`, the engine reverses it to `78.56.34.12` and appends a spam database URL (e.g., `78.56.34.12.zen.spamhaus.org`). If the DNS query returns an IP address like `127.0.0.2`, it confirms the server is marked as a spammer.

### 🔐 Email Security Parsing (SPF/DMARC)
* **Library:** Native JavaScript `RegEx` (Regular Expressions)
* **How it works:** The engine pulls all the "TXT" records on a domain. It loops through them seeking the prefix `v=spf1` or `v=DMARC1`. Once found, complex string-manipulation splits the records apart to find exact strictness tags (like `~all` vs `+all` or `p=none` vs `p=reject`).
* **Recursive SPF:** Our engine explicitly chases `include:target.com` statements inside SPF records to count the true amount of background DNS lookups, strictly enforcing the RFC 10-lookup global limit.

---

## 3. How the Results are Formatted

Once the `Promise.allSettled()` block finishes its race, the engine is holding a massive pile of raw test data. 

The engine uses a deterministic grading logic to assign **Severities** (`Passed`, `Warning`, `Error/Critical`) to each item.

It then formats these into a strictly typed `FullHealthReport` JSON Object.

### The Final Payload Structure

```json
{
  "domain": "example.com",
  "status": "At Risk",
  "timestamp": "2024-10-27T12:00:00Z",
  "results": [
    {
      "category": "DNS Routing",
      "status": "Passed",
      "details": "A Record points to 192.168.1.1"
    },
    {
      "category": "Email Security",
      "status": "Critical",
      "details": "DMARC policy is missing entirely."
    },
    {
      "category": "Web Server",
      "status": "Warning",
      "details": "Cloudflare WAF (403 Forbidden) is blocking automated checks."
    }
  ]
}
```

This perfectly structured, categorized JSON object is then immediately handed off to the React Frontend UI to draw the charts, or pushed directly into the `issue_domains` MongoDB table.
