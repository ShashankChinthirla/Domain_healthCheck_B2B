# Domain Health Checker - Complete Technical Documentation

**Project Name:** Domain Health Checker
**Target Audience:** Junior Developers, QA Engineers, Operations, and Management

This document serves as the **ultimate, plain-English technical guide** for the Domain Health Checker project. It is written to provide absolute clarity—explaining every architectural component, data flow, and feature. Even if you have never seen the source code, reading this document will give you a **perfect understanding** of how the system operates from end to end.

---

## 1. Title Page

* **Project Name:** Domain Health Checker
* **Short Description:** An automated tool that acts like an "X-ray machine" for internet domains. It scans websites, network routing, and email security protocols to ensure a domain is safe, reachable, and correctly configured.
* **Purpose of the Project:** To help users instantly find and fix hidden misconfigurations before they cause website downtime, email spoofing (phishing), or brand reputation damage.

---

## 2. Project Overview

### What the System Does
If you type `google.com` into the system, it automatically checks behind the scenes if:
1. The domain actually exists and points to a real server.
2. The domain has proper "sender rules" (SPF) to stop hackers from sending fake emails using that domain.
3. The domain enforces strict delivery policies (DMARC/DKIM) to stop spam.
4. The website (`http://google.com` and `https://google.com`) is online and not broken.
5. The domain's IP address hasn't been flagged by global anti-spam organizations as malicious (Blacklisted).

### Why the System Exists
Configuring domains is heavily error-prone. One tiny typo in a DNS record can cause thousands of legitimately sent emails to bounce or land in the "Spam" folder. The system exists to **automate and simplify** the discovery of these errors so IT admins don't have to manually run complex command-line queries.

### Who Will Use the System
* **System Administrators:** Who recently deployed a new app and need to make sure the DNS routing works.
* **Cybersecurity Teams:** Who need to audit company domains to verify strict impersonation protections are live.
* **Marketing Teams:** Who are about to send a massive newsletter and must ensure their domain isn't blacklisted for spam.

### Main Problems It Solves
1. **The "Why is my email bouncing?" problem:** Translates cryptographic DNS records into human-readable advice (e.g., "Delete your duplicate SPF record").
2. **The "Wait, is our site down?" problem:** Proactively checks website reachability.
3. **The "Are we blocked?" problem:** Checks IP addresses against dozens of spam databases simultaneously.

---

## 3. System Architecture

To make scanning fast, the system is split into multiple pieces.

**Overall Architecture:**
The system uses a **RESTful Node.js API**. A user interacting with the website talks to the API, and the API does all the heavy lifting using an "Analysis Engine."

### The "Big Picture" Diagram

```text
       [Your Computer / Web Browser]
                  │
                  ▼ (Sends "example.com")
        [API Gateway (Express.js)]
                  │
                  ▼ (Validates the input)
      [Domain Analysis Engine (Core)] ────────┐
          │       │         │                 │
          ▼       ▼         ▼                 ▼
     [ DNS ]  [ Email ]   [ HTTP ]      [ Blacklist ]
     [Check]  [ Check ]   [ Check]      [   Check   ]
    (IP/Routing) (SPF/DMARC) (Website)     (Spam lists)
          │       │         │                 │
          └───────┼─────────┼─────────────────┘
                  ▼
        [Result Aggregator]
                  │ (Combines all results into one clean package)
                  ▼
         [Return JSON Response]
                  │
        [Your Computer / Web Browser shows the dashboard]
```

### Component Explanations
1. **API Layer (`server.ts`):** This is the front door. It receives the domain name, makes sure it's a valid word (not angry hacking code), and routes it securely into the backend.
2. **Domain Analysis Engine (`test-engine.ts`):** The brain of the operation. Instead of checking things one by one (which is slow), this engine screams **"Everybody go at once!"** and launches all tasks simultaneously in parallel.
3. **DNS Check Module (`dns-cache.ts`):** The system's phonebook. It talks to internet naming servers to find exactly which IP address belongs to the domain and where the email servers (`MX records`) live.
4. **Email Security Check Module:** This reads "TXT" records specifically to find security policies like SPF (approved senders), DKIM (digital signatures), and DMARC (enforcement rules).
5. **HTTP/HTTPS Availability Checker:** A mini web-browser that tries to connect to the domain using Port 80 (HTTP) and Port 443 (HTTPS) just to see if it gets a "200 Success" response.
6. **Blacklist Checker (`dnsbl.ts`):** Takes the IP addresses found in Step 3 and runs them against Spamhaus and Barracuda databases to see if the IP is marked as toxic.
7. **Response Generation:** The logic that takes a confusing networking error like `NXDOMAIN` and translates it into simple English: "Domain does not exist."

---

## 4. Architecture Flow Explanation

Here is the exact step-by-step path a request takes when you click "Scan":

1. **User Sends Request:** You type `microsoft.com` and click scan.
2. **API Receives Request:** A POST request carrying `microsoft.com` enters `/api/scan`.
3. **System Validates Domain:** The API strips off spaces, `https://`, and exact page URLs to get down to just `microsoft.com` (the root domain).
4. **DNS Queries are Executed (Phase 1):** The engine asks Google (8.8.8.8) or local system resolvers, *"What is the IP address and mail server for microsoft.com?"*
5. **Parallel Network Action (Phase 2):** Using the returned data, three things happen instantly at exactly the same time:
   * **Email Security Checks Run:** The engine searches for SPF, DKIM, DMARC TXT records and parses their syntax using Regex (pattern matching).
   * **HTTP Availability Check Runs:** Sends a quick web request to the webserver.
   * **Blacklist Checks Run:** Flips the IP address backward and asks the spam databases if it is flagged.
6. **Results are Aggregated:** The engine sets a strict 10-second stopwatch. When all checks finish—or if a check hits the 10-second limit and gives up—the engine wraps all the data together.
7. **Issue Classification:** The engine gives out grades: Pass (Green), Warning (Yellow), or Error/Critical (Red).
8. **Response Returned to Client:** A clean, easy-to-read JSON object is sent back to the front-end to render the UI charts.

---

## 5. Technology Stack

Everything is built on modern, scalable JavaScript technologies:

| Category | Technology Chosen | Why We Use It |
| :--- | :--- | :--- |
| **Backend Language** | Node.js / TypeScript | High speed, excellent at doing multiple network tasks simultaneously (async operations). |
| **Backend Framework** | Express.js | The industry standard for setting up simple, robust APIs. |
| **DNS Lookup** | Internal Node `dns.promises` and HTTPS (DoH) | For extremely fast internet querying. DoH (DNS over HTTPS) bypasses firewalls. |
| **HTTP Requests** | Native `fetch` API | Lightweight built-in method to ping websites without bulky libraries. |
| **Code Formatting** | Prettier / ESLint | Keeps code perfectly uniform for junior developers to easily read. |
| **Hosting Environment** | Vercel / Docker | Easy deployment that scales infinitely based on customer demand. |
| **API Format** | JSON | The easiest format for front-end React or Vue apps to digest. |

---

## 6. Core Features in Detail

* **Domain DNS Record Analysis:** Finds all IP addresses (`A`/`AAAA`), mail routing servers (`MX`), and nameservers (`NS`). It even checks if your MX record improperly points to a `CNAME` (which is against internet rules).
* **SPF Record Validation:** Not only does it find the SPF string, it executes "Recursive Checking." Meaning, if your SPF says "include google", the system actively follows that thread to ensure you don't exceed the global 10-lookup limit (a common mistake that breaks email).
* **DKIM Record Detection:** Checks 6 of the most common internet "selectors" (like `google`, `default`, `s1`) to see if cryptographic keys exist.
* **DMARC Record Validation:** Reads the policy flag (`p=`). It explicitly checks if you are actually enforcing security (`p=reject`) or if you are accidentally just monitoring it (`p=none`).
* **HTTP/HTTPS Website Accessibility Check:** Unlike a simple ping, it verifies if your web server actually completes a TLS/SSL handshake on port 443.
* **Domain Blacklist Reputation Check:** Reverses the IPv4 address and pings `zen.spamhaus.org` (and others) to check for listing statuses.
* **Issue Detection and Classification:** Automatically groups problems by severity so the user knows exactly what to fix first.
* **Smart Remediations (API):** The backend actively rewrites broken SPF/DMARC records into secure, valid configs via the `/api/recommend` pathway!

---

## 7. Domain Health Checks (Detailed)

Here is exactly what the system tests, why it matters, and how it figures it out:

### SPF (Sender Policy Framework)
* **What it does:** A public list of IP addresses allowed to send email from your domain.
* **Why it is important:** If you don't have it, anyone (like a hacker) can send an email claiming to be your CEO, and Gmail will accept it.
* **How the system checks it:** Searches for a TXT record starting with `v=spf1`. It counts the number of lookups, checks for duplicate records, and scrutinizes the ending command (`-all` vs `+all`).
* **Valid Example:** `v=spf1 include:_spf.google.com ~all` (Tells Gmail to accept Google IPs, but treat others with suspicion).
* **Invalid Example:** `v=spf1 include:malicious.com +all` (The `+all` at the end literally means "Approve the entire internet").

### DKIM (DomainKeys Identified Mail)
* **What it does:** Acts as a wax-seal on an envelope. It digitally signs the email content.
* **Why it is important:** Proves the email wasn't intercepted and altered between the sender and the receiver.
* **How the system checks it:** Checks specifically named TXT records (like `google._domainkey.domain.com`) to find cryptographic public keys starting with `v=DKIM1`.
* **Valid Example:** `v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb...`
* **Invalid Example:** The record is simply missing.

### DMARC (Domain-based Message Authentication)
* **What it does:** The boss of SPF and DKIM. It tells the receiving server exactly what to do if an email *fails* the SPF/DKIM tests.
* **Why it is important:** Without DMARC, even if SPF fails, Gmail might still put the fake email in the inbox. DMARC `p=reject` forces Gmail to delete it.
* **How the system checks it:** Looks exactly at `_dmarc.domain.com`. It ensures the `p=` tag is strict, and checks that `rua` email syntax is valid.
* **Valid Example:** `v=DMARC1; p=reject; rua=mailto:admin@domain.com;`
* **Invalid Example:** `v=DMARC1; p=none;` (The policy is set to 'none', meaning no enforcement is happening).

### HTTP / HTTPS Availability
* **What it does:** Verifies your website acts like a website.
* **Why it is important:** A domain is useless if the storefront is offline.
* **How the system checks it:** Sends an `fetch` command to `http://domain`.
* **Valid Example:** Returning an HTTP code `200 OK` or `301 Redirect`.
* **Invalid Example:** Returning `500 Server Error`, or endless loading (Timeouts).

### DNS Resolution (A / MX / NS)
* **What it does:** Ensures the domain is properly registered and wired into the global internet.
* **Why it is important:** If DNS is broken, emails and websites cease to exist entirely.
* **How the system checks it:** Native backend UDP/TCP querying to nameservers.
* **Valid Example:** Successfully retrieving `192.168.1.100` and `ns1.cloudflare.com`.
* **Invalid Example:** The query returns `NXDOMAIN` (Meaning Non-Existent Domain).

### Domain Blacklist Status
* **What it does:** Checks global databases operated by security firms.
* **Why it is important:** If your IP is blacklisted, your company emails will automatically go straight to the Junk folder of every recipient on Earth.
* **How the system checks it:** Takes the IP `1.2.3.4`, reverses it to `4.3.2.1`, and asks Spamhaus: `"Hey, is 4.3.2.1.zen.spamhaus.org returning a positive hit?"`
* **Valid Example:** No results are found. You are clean.
* **Invalid Example:** Database returns a `127.0.0.X` code, which confirms you are listed for sending spam.

---

## 8. API Documentation

To use the powerful engine programmatically, developers can hit these endpoints:

### The Main Scan Endpoint
* **URL Structure:** `/api/scan`
* **Method:** `POST`
* **Request Format (JSON):** You must send a JSON body.
* **Parameters:**
  * `domain` (String, Required): The exact domain. E.g., `"example.com"`.

**Example Request:**
```bash
curl -X POST http://localhost:8080/api/scan \
-H "Content-Type: application/json" \
-d '{"domain": "apple.com"}'
```

**Example Response (Clean, shortened logic):**
```json
{
  "domain": "apple.com",
  "status": "success",
  "results": {
    "dns": {
      "status": "passed",
      "records": ["17.253.144.10"]
    },
    "spf": {
      "status": "warning",
      "info": "Lookup Limit Reached",
      "reason": "12 recursive lookups found, limit is 10."
    },
    ...
  }
}
```

### The Recommendations Endpoint
* **URL Structure:** `/api/recommend`
* **Method:** `POST`
* **Purpose:** Takes a broken domain and instantly generates syntactically perfect SPF and DMARC configurations customized to the domain.
* **Request:** `{"domain": "broken.com"}`
* **Response:**
```json
{
  "domain": "broken.com",
  "records": {
    "dmarc": {
      "current": "v=DMARC1; p=none",
      "recommended": "v=DMARC1; p=reject; sp=reject; pct=100; rua=mailto:dmarc-reports@broken.com;",
      "action": "Update"
    }
  }
}
```

---

## 9. Error Handling

A system is only as good as what it does when things break. Our system never randomly crashes. It catches failures gracefully:

* **Invalid Domains Provided:** If someone typing `localhost` or `SQL_INJECTION*`, the API instantly kicks it back with an HTTP 400 Bad Request error.
* **DNS Lookup Failures:** If a name server goes down, the system simply applies a `status: "Error"` label to that specific test. It does **not** stop checking the HTTP or Blacklist modules.
* **Network Timeouts:** Sockets aren't allowed to load forever. If a website takes longer than exactly 5,000 milliseconds, the test kills the connection and confidently marks the website as "Timed Out/Unreachable".
* **Rate Limits (DNS over HTTPS):** If Google starts blocking our queries because we are scanning too fast (HTTP 429), our engine explicitly notices the block and automatically swaps to Cloudflare or Quad9 seamlessly.

---

## 10. Security Considerations

We protect the application and the servers it runs on from malicious attacks:

* **Input Validation & Sanitization:** It strictly strips out spaces, protocols (`http://`), and URL paths to prevent hackers from executing code.
* **SSRF (Server-Side Request Forgery) Prevention:** Because the tool pings websites, a hacker might try to put `127.0.0.1` into the tool to scan our internal, private databases. Our engine specifically checks if an IP is "Private/Local" and refuses to scan it.
* **Timeout Protections:** A hacker could stand up a server that drips 1 byte of data per minute, intentionally holding our servers open until they run out of RAM (Slowloris attack). We strictly use hard AbortControllers to sever connections if memory is at risk.

---

## 11. Deployment and Setup

How to get this code running on a laptop for a junior developer:

**1. Copy the Code (Clone):**
```bash
git clone https://github.com/your-username/domain_healthcheck.git
cd domain_healthcheck
```

**2. Give it the tools it needs (Install):**
```bash
npm install
```

**3. Run the Development Server:**
```bash
npm run dev
```
*(The terminal will say: "🚀 Domain Scanner API is listening on port 8080")*

**4. Build Strategy for Cloud (Production):**
If pushing to Vercel or AWS, run `npm run build` to compile the TypeScript into brutally fast optimized Javascript, then run `npm start`.

---

## 12. Performance Considerations

* **Parallel DNS queries:** Node.js executes `Promise.all()`. This means checking Blacklists, DNS, HTTP, and SPF all happen concurrently. A scan takes only as long as its completely slowest module (usually just a few seconds), rather than adding up the time of all 20 individual checks.
* **DoH (DNS over HTTPS):** The `dns-cache.ts` bypasses local OS DNS limits by sending DNS requests structured as secure web traffic directly to Google to avoid local firewall blocking on Port 53.
* **Graceful Overloads:** A custom concurrency funnel ensures that if you scan 500 domains, it won't crash our internet driver by limiting active sockets to safe levels automatically.

---

## 13. Limitations

Even highly tuned software has limits:
* **DKIM Fuzzing:** DKIM requires explicit "Selector names" (like passwords). We check the 6 most common ones, but we simply cannot definitively say "DKIM is missing" because the company might be using a totally random, custom selector name we don't know to ask for.
* **WAFs (Web Application Firewalls):** When checking HTTPS, some highly secure domains (like banks behind Cloudflare) detect our system is a bot, and they aggressively block the ping (Returning a 403 Forbidden). We have to label this a "Warning" instead of a true site-down error.

---

## 14. Future Improvements

What comes next for the engine room?
* **SSL Certificate Parsing:** Building a tool that reads the exact Expiry Date of an HTTPS certificate and issuing alerts 14 days before it dies.
* **WHOIS Expiration Tracking:** Connecting into the internet registry databases to determine the day the actual domain name needs to be repurchased.
* **Massive Bulk Scans:** Adapting the architecture to use queueing systems like `BullMQ` so users can upload an Excel sheet of 10,000 domains and let the system run overnight.

---

## 15. Conclusion

The Domain Health Checker simplifies the deeply technical, intensely frustrating world of internet routing and email security. By boiling down RFC-standards, complex cryptographic keys, and multi-layered DNS lookups into a perfectly formatted, single JSON report, the software ensures teams can always trust their digital real estate is secure and accessible.
