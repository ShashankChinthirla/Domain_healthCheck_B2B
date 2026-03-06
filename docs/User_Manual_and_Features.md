# User Manual, Educational Guide & Core Features

Welcome to the **Domain Health Checker**. This detailed educational manual explains how the platform functions, specifically detailing how Administrators log in, configure Cloudflare sync scripts, manage settings, and remediate domain issues in bulk.

### Important: Adding Videos to Documentation
If you are reading this on GitHub or a standard Markdown viewer, you can physically add videos to these documents to showcase the UI! 
Just upload your `.mp4` into the codebase, and paste this generic HTML code inside the document:
```html
<video src="/my-demo-video.mp4" controls width="100%"></video>
```

---

## 1. Initial Authentication & Login (Firebase)

The application features a strictly protected Backend Admin route.

**How to Login:**
1. Navigate to the top right of the dashboard and click the **`Admin Login`** button.
2. An elegant blurred modal will appear. Input the secure credentials provided to you by your IT Lead.
3. The system contacts Firebase Authentication immediately. 
4. If your email is listed inside the root `roles` MongoDB Table as an "Admin", the top navigation bar will unlock two new tabs: **Settings** and **Action Center**.

---

## 2. Navigating the Settings Page (`/settings`)

Once authenticated as a root Admin, navigate to the `Settings` page. This is the command hub for dictating how the application interfaces with 3rd-party services.

### 2.1. General Display
* Customize your internal **Display Name**. This name is used exclusively inside the App to let other administrators know who is handling which configuration.

### 2.2. Authentication (Integrations)
You can directly link Cloudflare to auto-import 10,000+ domains into the app without manually typing them.
1. Log into your Cloudflare Dashboard.
2. Go to `My Profile` -> `API Tokens` -> `Create Token` (Read-only Zone permission).
3. Copy the token.
4. Back inside the App Settings `Integrations` tab, select "Cloudflare", name it "My Business Account", and paste the key. 
5. The system instantly military-encrypts (AES-GCM 256) this key and syncs it.

### 2.3. Access Control (Root Admins ONLY)
* A specialized text-box allowing you to type multiple emails separated by commas (e.g. `john@apple.com, kate@apple.com`) and instantly grant them full Admin privileges via internal Firebase SDKs.
* You can selectively "Revoke" any admin by clicking the red Trashcan icon next to their name.

### 2.4. Outreach Defaults
When an admin notices an invalid Domain (e.g., bad DKIM keys), they must email the infrastructure owner.
Instead of typing the email manually every time:
1. Input your generic Signature (e.g. *John Smith, Senior DevSecOps, 555-0000*).
2. Input a standard text template (e.g. *Hi, we noticed an error on your domain.*).
3. Select your Mail Provider (`Google Workspace / Gmail`, `Microsoft 365 / Outlook`, or system default).
4. The Action Center will now automatically generate dynamic emails using these defaults when interacting with users.

---

## 3. The Administration Action Center (`/admin`)

This page summarizes your entire web fleet in seconds. It relies on the settings you previously configured.

### 3.1. Fleet Synchronization
To rapidly analyze every domain you own:
1. Click the blue **"Sync Cloudflare"** button at the top right of the dashboard.
2. The UI will spin. Behind the scenes, the API connects to Cloudflare, fetches every root domain inside your account, checks the local DB to ignore duplicates, and cleanly inserts the new domains, marking them as `Needs_Scan`.
3. A green toaster notification will appear confirming exact domain pull counts.

### 3.2. Automation & Bulk Remediate
The Action Center showcases exactly which domains are `Secure` (Green) and `At Risk` (Red).
* **Filtering and Sorting:** Use the massive dropdown toggle to isolate domains simply missing `DMARC`, or sort directly for critical `Blacklist Issues`.
* **Outreach Execution:** If `apple.com` is flagged for Missing SPF, the owner's email will be hyperlinked blue. Click it. The system will open a brand new Google / Outlook tab *already pre-filled* with the explicit SPF failure logic appended directly beneath your custom Outreach Settings template!
* **The Automation Terminal:** By clicking "Automation Monitor", the UI morphs into a black execution terminal. Administrators can view real-time Python/Node background logs performing the Bulk Remediations exactly as they run globally against thousands of records. You can safely download these generated CSV/XLSX results simultaneously to report to management.
