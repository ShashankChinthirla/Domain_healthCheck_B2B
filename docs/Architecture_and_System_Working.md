# Architecture and System Working Document

## 1. Project Overview
The **Domain Health Checker** is a full-stack SaaS application built to audit and monitor internet domains. It automatically interrogates DNS networking layers, email security authentication protocols (SPF, DKIM, DMARC), and web server availability, translating complex network data into actionable insights via a modern web interface.

This document describes the high-level architecture of the system, illustrating how the frontend, backend APIs, worker modules, database, and **Third-Party Integrations (Cloudflare)** seamlessly operate together.

---

## 2. High-Level Architecture Diagram
The application utilizes a stateless API architecture coupled with a modern reactive frontend, supported by secure API integrations for automated infrastructure discovery.

```text
       ┌────────────────────────────────────────────────────────┐
       │                 User Web Browser                       │
       │  (React / Next.js Client-Side Application)             │
       │  - Authentication Context (Firebase Auth)              │
       │  - UI Dashboards (Admin Action Center, Settings)       │
       └──────────────────────────┬─────────────────────────────┘
                                  │
                          (HTTPS JSON Payload)
                                  │
       ┌──────────────────────────▼─────────────────────────────┐
       │                   Next.js API Routes                   │
       │                 (Backend Entry Points)                 │
       │  - POST /api/scan (Core Testing)                       │
       │  - POST /api/sync-cloudflare (Metadata Fetching)       │
       │  - GET /api/admin/domains (Database Retrieval)         │
       └──────────────────────────┬─────────────────────────────┘
                                  │
       ┌──────────────────────────▼─────────────────────────────┐
       │               Domain Analysis Engine                   │
       │                    (test-engine.ts)                    │
       │                                                        │
       │   ┌────────────┐  ┌────────────┐  ┌────────────────┐   │
       │   │ DNS Worker │  │Email Config│  │ Web & Rep.     │   │
       │   │  (A, MX)   │  │ (SPF/DMARC)│  │ (HTTP/DNSBL)   │   │
       │   └────────────┘  └────────────┘  └────────────────┘   │
       └──────────────────────────┬─────────────────────────────┘
                                  │
       ┌──────────────────────────▼─────────────────────────────┐
       │                 Persistent Storage                     │
       │             (MongoDB - `issue_domains`)                │
       └──────────────────────────┬─────────────────────────────┘
                                  │
       ┌──────────────────────────▼─────────────────────────────┐
       │               3rd Party Integrations                   │
       │         (Cloudflare API / Python Cron Workers)         │
       └────────────────────────────────────────────────────────┘
```

---

## 3. Core Architectural Lifecycles

### 3.1. User Authentication (Firebase)
The system requires strict identity validation for administrative control.
1. User logs in via **Firebase Identity Platform** (Email/Password or OAuth).
2. The `onAuthStateChanged` context wrapper on the frontend detects the JWT Token.
3. The Next.js frontend checks the `isAdmin()` logic against a MongoDB collection of authorized admin emails.
4. If unauthorized, the `Layout.tsx` cleanly rejects them from specific sub-routes (e.g., `/settings`, `/admin`).

### 3.2. Cloudflare Fleet "Sync & Scan"
Instead of requiring users to manually type hundreds of domains, the architecture supports **Automated Fleet Discovery**.
1. An administrator securely saves a Cloudflare API Token in the **Settings** page. (This token is encrypted via AES-GCM 256-bit logic before hitting MongoDB).
2. In the **Action Center**, the admin clicks `Sync Cloudflare`.
3. The `/api/sync-cloudflare` routes decrypts the token, hits Cloudflare’s `api.cloudflare.com/client/v4/zones` endpoint, and pulls down every domain owned by the organization.
4. The system calculates the difference between existing DB domains and the newly found domains, cleanly upserting them with a status of `Needs_Scan`.

### 3.3. Bulk Remediate & Automation
1. Domains flagged with fundamental errors (Missing SPF/DMARC) appear in the Admin Dashboard.
2. Background workers (Node Cron or Python Sub-processes) continuously poll the MongoDB `issue_domains` collection.
3. The workers spin up parallel execution threads to batch-scan the domains asynchronously, writing the health status back to the DB cleanly.

---

## 4. Database Architecture (MongoDB)

The data model uses distinct collections to properly segregate state, logging, and security.

* **`users` / `roles`**: Validates which Firebase emails have Root Administrator status.
* **`user_settings`**: Stores JSON configuration (e.g., specific Outreach Email templates, chosen Email Client routers like Gmail vs Outlook) mapped to specific Admin User IDs.
* **`integrations`**: Stores the AES-GCM encrypted API tokens for 3rd party providers like Cloudflare.
* **`issue_domains`**: The master table of all discovered infrastructure, housing the massively detailed JSON outputs of every `A`, `MX`, and `TXT` record lookup.

---

## 5. Adding Videos to Documentation

Since this documentation is viewed in Markdown environments (like GitHub, VSCode, or standard CMS readers), you can **absolutely embed videos**. 

If your video is stored inside your codebase (e.g., inside the `domain_healthcheck/public/` folder), you can simply use the standard HTML `<video>` tag directly inside your `.md` files!

**Example Syntax:**
```html
<h2>Tutorial Demo</h2>
<video width="100%" controls>
  <source src="/my-demo-video.mp4" type="video/mp4">
  Your browser does not support the video tag.
</video>
```
*Note: If pushing to GitHub, ensuring the video is small (<10MB) or hosting it on YouTube/Vimeo and using a GIF preview is highly recommended for load speeds.*
