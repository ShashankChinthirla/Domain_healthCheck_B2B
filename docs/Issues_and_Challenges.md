# Challenges, Bugs, and Technical Roadblocks

Building the **Domain Health Checker** involved overcoming significant technical challenges that stemmed from integrating legacy internet protocols (DNS, SMTP) with modern corporate Linux hosting environments (PM2, Node clusters).

This document outlines the major bugs faced during development, exactly *why* they occurred, and the architectural solutions implemented to bypass them.

---

## 1. The Corporate Firewall "Port 53" DNS Blocking Bug

### The Challenge
Initially, the backend was built to query custom DNS servers (like Google `8.8.8.8` or Cloudflare `1.1.1.1`) directly using Node's `dns.promises.setServers()` method. This worked perfectly on local development machines. However, upon deploying to secure internal Linux instances behind restrictive corporate infrastructure, the entire application began throwing `ECONNREFUSED` and `EREFUSED` errors instantly.

### Why it Happened
Many corporate networks and modern data centers aggressively block outbound UDP traffic on Port 53 to prevent malicious actors from using their scalable infrastructure for DNS Reflection DDoS attacks. Because Node's `dns` module strictly uses Port 53 UDP, our custom queries were silently dropped by the platform firewall.

### The Solution: DNS-over-HTTPS (DoH) & Fallbacks
We completely rebuilt the `dns-cache.ts` module to be environment-aware.
1. The system attempts to use the OS's safe, default internal resolver first.
2. If the internal resolver fails, it explicitly bypasses Port 53 by sending an HTTP `fetch()` request (Port 443 TCP) to Google's DoH API: `https://dns.google/resolve?name=example.com&type=TXT`.

*This guaranteed 100% resolution success across strict firewalls.*

---

## 2. The Cloudflare "False Positive" Unreachable Bug

### The Challenge
When querying popular websites (like Banks or highly trafficked SaaS platforms), the HTTP Availability check would frequently return a total `"Status: Error | Web Server Unreachable"`, even though the website was perfectly fine when opening it in a standard web browser.

### Why it Happened
Modern Web Application Firewalls (WAFs), particularly Cloudflare's Bot Fight Mode, actively inspect the `User-Agent` and TLS handshake signatures of incoming requests. Because our Next.js backend used the native `fetch` API without browser-like headers, Cloudflare instantly flagged our scanner as a "Scraper Bot" and forcefully severed the connection with a `403 Forbidden` or `502 Bad Gateway`.

### The Solution: Heuristic Error Handling
We updated the business logic classifier. If the HTTP crawler receives a `403 Forbidden`, `429 Too Many Requests`, or `503 Service Unavailable`, it no longer fails the test. Instead, it marks the status as **"Warning"** with the subtext: *"Server is online but actively blocking automated pings (WAF Detected)."*

---

## 3. The "Slowloris" Memory Exhaustion Crash

### The Challenge
When allowing users to upload CSVs of 500+ domains into the Admin Bulk Scanner, the Node.js server would randomly spike to 100% CPU usage and crash with an `Out of Memory (OOM)` exception.

### Why it Happened
Network requests are unpredictable. If 10 out of those 500 websites belong to a faulty web host that holds the TCP socket open but trickles data at 1 byte per second (a phenomenon known as a Slowloris state), the `Promise.all()` holding those 500 connections open would never resolve. The Node.js Garbage Collector couldn't clear the memory, crashing the V8 Engine.

### The Solution: Aggressive AbortControllers
We implemented a strict, non-negotiable `withTimeout()` wrapper around every single external network call.
We instantiated JavaScript `AbortController` functionality. If a socket is open for `> 5000ms`, the controller triggers a hard `.abort()`, severing the socket forcefully at the OS level, capturing the timeout error, and allowing the Garbage Collector to clean the RAM.

---

## 4. The SPF "Limit Exceeded" Invisible Bug

### The Challenge
A user scanned a perfectly valid, beautifully formatted SPF record: `v=spf1 include:salesforce.com include:hubspot.com include:google.com ~all`. 
The system passed it as "Valid". However, the user complained that Gmail was still bouncing their emails with an SPF failure.

### Why it Happened
The initial architecture only used Regex to ensure the *syntax* of the SPF string was correct. It failed to account for the **RFC 7208 10-Lookup Limit**. Salesforce, Hubspot, and Google all `include` other domains internally. The single string above actually required 14 nested DNS lookups to resolve completely. Gmail strictly enforces a limit of 10. Anything over 10 results in an automatic "PermError" (Failure).

### The Solution: Recursive Logic Engine
We wrote a deeply complex `getRecursiveSPFLookupCount()` function. When the engine parses an SPF record, it doesn't just read the string. It actively chases every single `include:`, downloading the target's TXT records, counting them, and recursively diving into the next include until the tree is fully mapped. The UI now actively throws a **Critical Error** if the true nested count exceeds 10.

---

## 5. The Shared-IP Blacklist Warning Fatigue

### The Challenge
Users who hosted their emails on Google Workspace (Gmail) or Microsoft Office 365 began angrily reporting that our tool claimed they were "Blacklisted," demanding to know why Spamhaus marked their domain as dangerous.

### Why it Happened
Massive infrastructure providers (Google/Microsoft) share outbound SMTP IP addresses among millions of customers. A spammer using Office 365 might get that specific Microsoft IP temporarily listed on a minor database like `SORBS` or `Spamcop`. If an innocent user scans their domain, the system resolves the MX record to that same shared Microsoft IP, triggering a blacklist hit solely because they share a neighborhood with a spammer.

### The Solution: Big-Tech Whitelisting Filters
Major inbox providers know to ignore shared Microsoft/Google IPs on minor blacklists. We updated `check_ip_blacklist.ts` to execute a cross-reference. If the IP address belongs to known ASN ranges (Google/Outlook/AWS SES), the system downgrades the Blacklist severity from **"Critical"** to **"Info"**, explaining that the listing is transient and handled by the provider.

---

## 6. Real-Time Admin Table Desync

### The Challenge
When multiple admins utilized the system simultaneously, Admin A would click "Bulk Remediate", which updated the issues in the DB. However, Admin B's dashboard still showed the old, broken data until they manually hit "Refresh" in their browser.

### Why it Happened
Next.js 15 aggressively caches `GET` requests using its internal Data Cache. The `/api/admin/domains` endpoint was returning stale data instantly from the server edge cache instead of pinging MongoDB for the fresh updates.

### The Solution: Cache Busting
We appended `export const dynamic = 'force-dynamic';` and `revalidate = 0` to the top of all Admin API routes, ensuring Next.js completely bypasses Route Caching. We also layered `SWR` (Stale-While-Revalidate) hooks on the frontend to automatically poll the MongoDB state every few seconds, guaranteeing realtime synchronized dashboards across all active administrative users.
