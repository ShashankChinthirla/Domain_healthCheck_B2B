# Domain Health Checker - Detailed Backend Engineering Documentation

---

## 1. SYSTEM OVERVIEW

**What the system does:**
The backend is an asynchronous network diagnostic tool. It ingests domain names and executes highly parallelized requests against global DNS resolvers, HTTP web servers, and third-party blocklist databases to extract infrastructure configurations.

**The problem it solves:**
Diagnosing email deliverability (Why did an email bounce?) and website uptime requires disparate, complex CLI tools (`dig`, `nslookup`, `curl`, WHOIS). This system unifies these network layers into a single, automated, structured JSON API.

**Who uses it:**
Engineering teams, DevOps/SREs, and IT administrators managing domain portfolios who need instant infrastructure audits without writing bash scripts.

**Why it exists:**
To abstract the extreme nuance of RFC formatting errors (e.g., duplicate SPF records, broken DMARC policies, missing DNS glue) into programmatic, automated alerts that can be plugged into dashboards or CI/CD pipelines.

**How it fits into infrastructure:**
It operates as a stateless API microservice (Node.js/Express). It receives REST requests, performs outbound network I/O, applies Business Logic classifiers to the raw data, and returns formatted datasets. It is designed to sit behind a Load Balancer (or in Vercel API Routes) with horizontal scaling.

---

## 2. HIGH LEVEL ARCHITECTURE

The entire architecture relies on an "Event Loop" model where one incoming HTTP request spawns dozens of non-blocking outbound network requests, aggregating the findings into a unified payload gracefully.

### Component Interaction Diagram

```text
       [Client Application (React/Next.js)]
                       │
   POST /api/scan {"domain": "example.com"}
                       │
             [ Express.js API Gateway ]
             (Rate Limiting & Validation)
                       │
       ┌───────────────┴────────────────────────┐
       │   Domain Analysis Engine (Controller)  │
       │   (Spawns Phase 1 & Phase 2 workers)   │
       └─┬─────────┬─────────┬────────┬─────────┘
         │         │         │        │
  [ DNS Resolver ] │         │        │   (Resolves A, MX, TXT)
  (System/DoH)     │         │        │
         │         │         │        │
         ├◄────────┘         │        │   (Injects A/MX into other checks)
         │                   │        │
 [ Email Security ]          │        │   (Parses TXT for SPF/DKIM/DMARC)
 (Syntax Validators)         │        │
                             │        │
                     [ HTTP Crawler ] │   (Pings HTTP/HTTPS via Fetch/Axios)
                     (Redirection/TLS)│
                                      │
                             [ Blacklist Node ]
                             (DNSBL Reversed IP Lookup)
                                      │
       ┌──────────────────────────────┴─────────┐
       │ Result Aggregator & Issue Classifier   │
       │ (Waits for all Promises to Settle)     │
       └───────────────┬────────────────────────┘
                       │
       [ PostgreSQL / MongoDB Storage ] (Optional Persistence)
                       │
             [ HTTP 200 OK (JSON) ]
                       │
             [Client Application]
```

**Component Breakdown:**
* **API Gateway (Express):** Exposes `/api/scan` and routes it to the specific controller.
* **Domain Analysis Engine:** The core `test-engine.ts`. Orchestrates dependencies (e.g., getting the IP address first before handing it to the Blacklist module).
* **DNS Resolver:** A custom wrapped module (`dns-cache.ts`) using local UDP sockets and falling back to DNS-over-HTTPS (DoH) endpoints like Google (`8.8.8.8`) to bypass restrictive cloud firewalls.
* **Email Security Analyzer:** Dedicated logic to structurally analyze Sender Policy Framework (SPF) mechanics and DMARC enforcement tags.
* **HTTP Crawler:** Evaluates active webserver response codes, timeout thresholds, and valid TLS connections.
* **Blacklist Node:** Executes dynamic IP reversal and spam-list reputation queries against services like Spamhaus or Barracuda.

---

## 3. BACKEND SERVICE ARCHITECTURE

The Node.js codebase strictly separates network transport protocols from the business evaluation logic.

* **API Layer (`server.ts`):** Only handles HTTP context. Validates the `req.body`, normalizes the domain string, and executes the engine.
* **Request Validation Layer:** Sanitizes `http://`, `www.`, and trailing slashes so the engine only processes the root Fully Qualified Domain Name (FQDN).
* **Domain Processing Engine (`test-engine.ts`):** The master orchestrator. Employs `Promise.allSettled()` to fire workers asynchronously without locking the thread.
* **Worker Modules (`check_mx.ts`, `dnsbl.ts`):** Pure, isolated functions. Given an input (Domain or IP), they perform exact tasks and return a strictly typed `TestResult` object containing `status` and `reason`.
* **Result Aggregator:** The engine guarantees a return by enforcing strict `setTimeout` races against all promises.
* **Storage Layer (Future Scope):** Pre-built hooks to map the `FullHealthReport` object to a NoSQL or SQL object mapping for history retention.

**Communication Between Modules:**
Modules do not call each other. The Processing Engine queries Phase 1 (DNS). When Phase 1 resolves, it passes the data horizontally into Phase 2 (Email, HTTP, Blacklists) via simple JavaScript arrays. 

---

## 4. REQUEST LIFECYCLE

The life of a single request from start to finish:

1. **User sends request:** JSON payload `{"domain": "target.com"}` hits `/api/scan`.
2. **API receives request:** Express receives, checks HTTP headers/auth, and body structure.
3. **Domain validation:** The system confirms it contains no illegal bash characters and represents a valid TLD format.
4. **Domain normalization:** `target.com` is extracted bare.
5. **DNS resolution (Phase 1):** The Engine queries A, MX, TXT, NS, SOA records simultaneously.
6. **Parallel checks executed (Phase 2):** Using Phase 1 data, the Engine fires off `runSPFTests()`, `runDMARCTests()`, `runHTTPTests()`, and the Blacklists concurrently.
7. **Data aggregation:** As each function completes, they push `TestResult` objects into categorized arrays (e.g., "DNS", "Email").
8. **Issue classification:** If a worker function encounters `p=none` in DMARC, it labels the `TestResult.status` as `Error` or `Warning`.
9. **Data stored in database:** (If implemented) The massive finalized object is written to DB.
10. **Response returned:** Express fires `res.json()`. Status code `200` is returned containing the payload.

---

## 5. CORE PROCESSING ENGINE

This is the most critical operational component of the architecture (`test-engine.ts`).

* **Asynchronous Processing:** No `await` blocks other lines from running unless strictly dependent. 
* **Parallel Checks:** `Promise.all([Task1, Task2, Task3])` is used to execute 15+ network requests simultaneously over the Node.js Non-Blocking I/O thread. A scan taking 2 seconds is bound by the *slowest* individual response, not the *sum* of all responses.
* **Dependency Management:** DNS Blacklisting requires an IP. Therefore, `dns.resolve4()` must complete before `checkBlacklist(ip)` can be pushed to the active Promise array.
* **Timeout Handling:** A rogue web server might hold a socket open for 60 seconds (Slowloris). We wrap *all* module calls in `withTimeout(promise, 5000ms)`. If it exceeds 5000ms, the wrapper rejects the promise locally and returns a handled payload: `"Status: Timeout"` without hanging the API.
* **Result Aggregation:** Categorical reduction. `DNS Results -> []`, `HTTP Results -> []`, ensuring the client JSON remains perfectly typed according to the `FullHealthReport` interface.

---

## 6. DATABASE DESIGN

*(Note: While the provided source mainly acts as a stateless API hook, this is the architectural mandate for production scaling)*

**Why a database is used:**
To track changes over time (e.g., "When did we accidentally break our SPF record?") and to allow bulk scanning of thousands of domains offline (saving the results for later viewing). 

**Schema Design (PostgreSQL/Relational):**

**`domains` table** (The core entities)
| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Unique domain identifier. |
| `domain_name` | VARCHAR | The root string (e.g. `github.com`). Unique. |
| `created_at` | TIMESTAMP | Injection time. |
| `last_scanned_at` | TIMESTAMP | Useful for cron update routines. |

**`scan_results` table** (The historical snapshops)
| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | UUID (PK) | The specific scan event ID. |
| `domain_id` | UUID (FK) | Reference back to `domains`. |
| `scan_timestamp` | TIMESTAMP | Exact time of the network query. |
| `overall_status` | ENUM | Computed status: `Passed`, `Warning`, `Critical`. |
| `scan_duration_ms`| INTEGER | Performance latency metric. |
| `dns_raw_data` | JSONB | A dense blob of all A, MX, CNAME, TXT outputs. |
| `security_raw_data`| JSONB | Blob of extracted SPF string, DMARC p= tag, DKIM keys. |
| `http_availability`| JSONB | Server response headers and latency (ms). |
| `blacklist_score` | INTEGER | Sum of the active blacklist hits (0 = Clean). |

**Relationships:** `domains` (1) : (N) `scan_results`. Querying `scan_results` Ordered By Time DESC gives the "Health Timeline" of a specific piece of infrastructure.

---

## 7. DATA FLOW

Data moves in one direction through the entire system:

1. **Client Request:** `{"domain": "stripe.com"}` received by Node process.
2. **Backend API:** Body parsing middleware translates JSON stream to JavaScript Object. Express router validates payload schema.
3. **Processing Engine:** Rejects payload if invalid. Otherwise, initiates the testing sequence.
4. **External DNS queries:** UDP sockets open to OS default nameservers asking for target records.
5. **Analysis modules:** Module functions like `runSPFTests()` are fed the returned TXT records. They use complex Regex and string manipulation to evaluate the configuration.
6. **Aggregation:** Modules return formatted JSON interfaces. The engine reduces these into an array of Categories (DNS, Blocklists, Server Routing).
7. **Database storage:** Object mapping translates the JSON categories efficiently into Postgres `JSONB` rows linked to the user's account ID.
8. **API response:** Express forces HTTP 200, serializing the final object back to the client application socket.

---

## 8. DOMAIN ANALYSIS MODULES

These specialized workers perform the actual interrogations.

### DNS Resolution
* **Purpose:** Determine foundational routing (IP addresses and Mail hubs).
* **Algorithm:** Node native `dns.promises`. Has a built-in fallback to `fetch` DNS-over-HTTPS (DoH) via Google/Cloudflare endpoints if UDP Port 53 is blocked by the host platform (like Vercel and AWS Lambda).
* **Input:** `target.com`
* **Output:** Arrays of IPs, MX Exchanges, and nested TXT arrays.
* **Edge Cases:** Resolvers randomly dropping packets under load returning blank `[]` arrays instead of `ENOTFOUND` errors. Handled by aggressive retrying logic in `dns-cache.ts`.

### SPF Analysis
* **Purpose:** Validate IP authorizations to combat email spoofing.
* **Algorithm:** Regex matching `v=spf1`. **Crucially, executes a Recursive Lookup algorithm**: If it sees `include:_google.com`, it triggers a *new* nested DNS query to find what's behind the include, tallying the total lookups to ensure the domain does not exceed the absolute RFC max of 10 lookups.
* **Output:** Count of nested lookups, policy string, trailing strictness check (`+all` vs `-all`).
* **Edge Cases:** Redundant includes or SPF records broken into dozens of tiny TXT strings (which must be concatenated locally before parsing).

### DKIM Detection
* **Purpose:** Find active cryptographic keys.
* **Algorithm:** Iterates over the 6 most common selectors on the internet (e.g. `google._domainkey`, `default._domainkey`). 
* **Output:** Extracts base64 keys starting with `p=`.
* **Edge Cases:** We cannot guess custom/randomized selectors generated by boutique email hosts. 

### DMARC Validation
* **Purpose:** Validate policy enforcement.
* **Algorithm:** Subdomain query specifically to `_dmarc.target.com`. Maps the resulting string `v=DMARC1; p=...` to a K/V object.
* **Output:** Strictness of `p=` tag (none/quarantine/reject) and checks external Authorization matching of `rua=` report emails.
* **Edge Cases:** DMARC inheritance. If `sub.domain.com` lacks a record, the algorithm automatically rolls up and searches the parent `domain.com` to see if root policies cover the subdomain.

### HTTP Availability Check
* **Purpose:** Ensure Web Server uptime.
* **Algorithm:** Executes `fetch` against `http://` and `https://`. Checks status codes, measures response latency, and validates Redirect paths.
* **Output:** Booleans for `up`, latency `ms`, and `location` headers.
* **Edge Cases:** Servers rejecting non-browser User-Agents. Systems returning 403 Forbidden due to Web Application Firewalls (Cloudflare) blocking automated bot scrapers.

### Blacklist Detection
* **Purpose:** Evaluate SPAM reputation.
* **Algorithm:** IP reversal (DNSBL protocol). Takes `192.168.1.1` and queries `1.1.168.192.zen.spamhaus.org`. 
* **Output:** Maps successful returning IPs (like `127.0.0.4`) to threat severity levels. 
* **Edge Cases:** Providers heavily rate-limit queries and artificially return "Blocked" responses if the AWS engine queries too fast. Backend detects these specific throttle codes and handles them silently via fallback queues.

---

## 9. BUSINESS LOGIC

The API uses clear deterministic heuristics to categorize the issues it finds into three distinct severity tags.

* **Passed:** Configuration is fully compliant with modern RFCS and security postures. 
* **Warning:** Configuration functions, but is non-optimal, mildly insecure, or technically violates strict RFCS but works in practice. 
* **Critical (Error):** Fundamental architectural failure ensuring downtime, or actively dangerous security postures exposing organizations to immediate attacks.

**Decision Engine Logic Matrix (Examples):**
* `A Record (IP)` is Private (e.g. `10.0.0.1`) → **Critical** (Unroutable).
* `DMARC record` is completely missing → **Critical** (Total spoofing vulnerability).
* `DMARC policy` is `p=none` → **Warning** (Monitoring exists, but actively refuses to enforce security).
* `SPF Terminator` is `+all` → **Critical** (Literally authorizes the entire globe to send email as this domain).
* `SPF Terminator` is `~all` (Softfail) → **Passed / Warning** (Widely accepted, but slightly less secure than `-all`).
* `DNS Blacklist` returns true on Spamhaus → **Critical** (Emails will bounce globally).
* `HTTP Response` is `403 Forbidden` → **Warning** (Server is actually online and processing, but rejecting the query based on User-Agent).

---

## 10. ERROR HANDLING STRATEGY

Unreliable remote networks must never crash the executing Node environment. Graceful degradation is strictly implemented.

* **DNS lookup failure (Domain Missing):** Node's `ENOTFOUND` is caught inside the worker loop. Status is gracefully mapped to `Status: Error | Category: Missing DNS`. The promise does not reject; it resolves with a classified failure object.
* **Network timeout (Hanging Server):** The global 10-second `withTimeout` wrapper forces a resolution of `Status: Error | Reason: Network Endpoint Unreachable` rather than hanging the user's dashboard endlessly.
* **Invalid domain (Regex failure):** Handled before the engine starts with a synchronous HTTP `400 Bad Request`.
* **External API/Provider Failure:** DNS-over-HTTPS fallback allows for `fetch` retries across 3 different providers (Google/Cloudflare/Quad9) if one starts limiting request quantities (HTTP 429).
* **Blacklist service unavailable:** DNSBL queries heavily throttle. If query logic returns generic `127.255.255.255` (throttle IP code), backend accurately identifies this not as a spammer, but as an Engine API block. It resolves cleanly as "Throttle Warning" bypassing the database hit.

---

## 11. SECURITY MODEL

As a system built to ping untrusted, externally-provided hostnames, it acts natively as a proxy.

* **Input Validation:** Strict parsing. Only characters `[a-z0-9.-]` are authorized. Input sizes hard-capped at 253 characters (RFC standard limit).
* **SSRF (Server-Side Request Forgery) Prevention:** Because the tool connects via `fetch` to a provided URL, a malicious actor could input an internal AWS metadata IP (`http://169.254.169.254`). A global guard function explicitly evaluates target IPs before execution to block `Private (RFC1918) IP Lookups` dead in their tracks.
* **Rate Limiting:** Sliding-window token buckets per IP/User to prevent malicious actors from utilizing the architecture as a DDoS proxy against third parties.
* **Timeout Protection:** Hard delays on Promises. Prevents Slowloris-style thread hanging where malicious payload servers deliberately trickle packets back to exhaust Node.js runtime memory.
* **Request Sanitization:** Excludes command line control characters mapping directly to internal OS processes.

---

## 12. PERFORMANCE DESIGN

Node.js provides magnificent internal networking concurrency patterns out of the box.

* **Parallel DNS Socketing:** By enforcing heavily grouped `Promise.all([cname, mx, a, itxt])` structures, the engine hits the OS networking stack simultaneously.
* **DNS Resolver Deduplication (`dns-cache.ts`):** Identical DNS lookups requesting the same TXT record from multiple sub-modules pull from a localized Map cache valid for 10 seconds. This prevents duplicating external I/O on identical overlapping lookups during a fast scan constraint. 
* **Queue Backpressure Controls:** A concurrency governor limits active DNS requests to `MAX_CONCURRENT_QUERIES = 250`. If the system scans 50 domains at once, request #251 waits in a queue until a slot frees up. This prevents complete socket starvation and random `EAI_AGAIN` drops from the local OS network driver.

---

## 13. SCALING STRATEGY

For transforming this API from simple one-off checks to scanning ten thousand domains every hour:

* **Horizontal Scaling:** API layer is fundamentally stateless. It exists neatly in Docker containers that can horizontally scale via Kubernetes pods based on CPU/RAM autoscaling logic behind Nginx Load Balancers.
* **Decoupled Queue Processing:** By implementing `Redis` + `BullMQ`. Instead of holding the API connection open dynamically waiting for a massive scan batch, the API returns a `202 ACCEPTED` Job ID. Worker Node pods process jobs asynchronously out of memory queues and write directly to the Postgres cluster in bulk transactions.
* **Distributed Geo-Scanning Services:** Offloading heavy HTTP/Port checking to remote serverless runners (e.g., AWS Lambdas running in Europe/Asia) to guarantee geo-routing analysis independently from the central engine.

---

## 14. RISK ANALYSIS

Maintaining infrastructure checking architectures involves dependencies on third parties that can unexpectedly fail.

* **Risk: DNS Spoofing against the runner:** Backend relying on poisoned VPC nameservers may incorrectly ingest bad configurations. 
  * **Mitigation:** Built-in `fetch`-based HTTP DoH paths strictly validating responses from Google over TLS, ensuring absolute veracity of the record outputs.
* **Risk: Blacklist Service Bans:** High-volume traffic to Spamhaus triggers IP bans on the runner.
  * **Mitigation:** Backend grace logic detects standard ban IP responses and skips the check, returning a clear system Warning of "API Quota Exceeded" without producing a false positive "You are Blacklisted" alarm to the user.
* **Risk: Large Scale Memory Exhaustion:**
  * **Mitigation:** Implementing the `250 Query Buffer Queue` means no matter how many queries arrive, the engine processes them systematically and sustainably without exploding V8 heap memory.

---

## 15. OBSERVABILITY

Backend teams require absolute visibility into failures inside stateless environments.

* **Console Logging:** Standardized output prefixing `[SCANNER]` and `[DNS]` clearly detailing lifecycle transitions (e.g. `Starting health check for target...`, `Falling back to OS system resolver...`). 
* **Request Latency Analytics:** Writing the overall `duration_ms` of every scan to logging clusters (Datadog/Elastic). Enables dashboarding of average resolution time, classifying whether global API slowdowns mirror target internet slowness or internal Node bottlenecking.
* **Detailed Error Boundaries:** The generic Express API catch block returns simple `500 Server Errors`, but internally passes the exact node stack traces `console.error` for pipeline collection (Sentry.io). 

---

## 16. DEPLOYMENT ARCHITECTURE

The deployment model assumes modern Vercel or Containerized environments.

* **API Runtime:** TypeScript compiled to standard Javascript. Extremely minimal. Fully compatible with Node v18+ execution boundaries.
* **Vercel/Serverless Fallbacks:** Many PaaS platforms block native UDP traffic (the standard method for DNS resolution). The codebase is specifically built to detect Vercel environment flags, forcing all DNS logic to route through authorized HTTP proxies to ensure consistent functionality anywhere.
* **Environment Variables:** All application secrets (DB credentials, proprietary Blacklist API tokens, SSL params) injected strictly through `.env` variable files locally or Vault/K8s Secrets natively. 
* **Production Setup:** Enforces mandatory TLS encrypted connections inbound. 

---

## 17. LIMITATIONS

* **DKIM Selector Bruteforcing:** Because DKIM is stored on specific subdirectories (selectors) chosen arbitrarily by the admin, the system must guess the selector. If an administrator uses `customkey44._domainkey.target.com`, the 6-key standard brute-force will not find it, yielding an incomplete report indicating "Not Found".
* **Internal Network Scanning:** The cloud engine cannot check the health of localized development intranet domains (e.g., `dev.local.network`) hidden behind corporate firewalls unless explicitly VPN'd into the topology.
* **True CNAME resolution complexity:** Deeply nested, cross-organizational CNAME records or looping aliases can artificially bloat recursive execution times if unbounded by the retry limits.

---

## 18. FUTURE IMPROVEMENTS

Backend logic constantly requires maintenance to support adapting internet standards. Expected expansions include:

* **SSL Date Parser Engine:** Directly connecting a `tls.connect` socket to Port 443 specifically to rip the certificate bytechain natively, exposing the raw `valid_from` and `valid_to` UTC timestamps for alerting "Certificate Expires in 14 days!"
* **WHOIS Integration Service:** Bridging the gap natively between technical infrastructure and managerial operations. Extracting registrar expiration dates via custom implementations of `tcp:43` socket protocols to global WHOIS servers.
* **Automated Continuous Monitoring (Cron):** Leveraging the storage schema and queues to write internal Cron jobs (AWS EventBridge). A 3:00 AM nightly sweep picking up all registered domains, executing a silent scan, diff-checking against yesterday's JSON blob, and firing Email Webhooks if a metric degraded (e.g., "Your Web Server just threw a 500 error!"). 
