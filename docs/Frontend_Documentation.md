# Frontend Architecture and UI Component Documentation

The Domain Health Checker utilizes the modern **Next.js 14 App Router** structure with **React Server/Client Components** (`use client`). This document explains how the complex Administration, Settings, Authentication, and the standard Home dashboard operate together to provide an enterprise-grade experience.

---

## 1. Global State & Authentication
The application relies strictly on **Firebase Auth** wrapped inside React `useEffect` hooks across critical routes.
* **Component: `LoginModal.tsx`**
  Renders a seamless, blurred background modal requesting Google OAuth or standard structural credentials.
* **Component: `Navbar.tsx`**
  Global navigation head. It uses the `onAuthStateChanged` hook constantly to determine if it should render the `Admin`, `Settings`, or `Login` buttons depending on the user's active session.

---

## 2. The Core Public App (`app/page.tsx`)
The home root provides the massive centralized search interface.
It connects to a component tree specifically separated for clarity:
* `<DomainChecker>` (Handles raw input states)
* `<HealthCards>` (Renders dynamic SVG icons mapping to `Secure` vs `At Risk` statuses)
* `<VerdictBanner>` (Giant Green/Red status banners highlighting absolute conclusions).

---

## 3. The Administration Action Center (`app/admin/page.tsx`)
This is a heavily protected component strictly for internal enterprise operators.

### 3.1. Overview UI
Graphs out basic statistics via a high-end dashboard overlay (Total Domains, At Risk Domains).

### 3.2. Cloudflare Fleet Pagination & Bulk Table
The core engine of the `Admin` screen. It pulls the entire raw MongoDB `issue_domains` database, rendering hundreds of rows dynamically using Next.js `Suspense` logic to prevent blocking. 
* **Filter Capabilities:** Dropdowns allow the user to specifically isolate exactly which domains lack `No_SPF_AND_DMARC`, `DKIM_Issues`, or hit `blacklist_issue`.
* **Outreach Execution:** If a specific domain lacks an owner mapping, the Admin clicks the user's profile icon—triggering a customized pop-out email workflow driven by their Settings.

### 3.3. Automation Monitor
This section links directly to the `automation_logs` stream in the Firebase Database. If the python-backed Background Bulk Workers encounter an API rate limit, the React code streams the real-time "Levels" (`ERROR`, `WARNING`, `SUCCESS`) directly into the admin terminal UI using the `onSnapshot` SDK.

---

## 4. Settings Page Configuration (`app/settings/page.tsx`)
Because an enterprise system needs adaptability, the Next.js Setting route provides 4 primary tabs to dictate how the system behaviors universally:

1. **General:** Profile display name customization.
2. **Authentication (Integrations):** Secure token submission. Admins input API variables (e.g., Cloudflare Key). React `fetch` routes POST this configuration strictly over HTTPS where the `lib/encryption.ts` logic securely stores it.
3. **Access Control:** Super-admins can type new domain emails. The backend validates roles to instantly expand dash access.
4. **Outreach Defaults:** Admins can type personalized signatures (e.g. `Head of IT, +1 555-0000`) and format specific error strings (e.g., *Your server has a blacklist violation*). The frontend saves these layouts strings to automatically populate their Gmail/Outlook bodies directly via deep-linking protocols.

---

## 5. UI Elements & Libraries
* **Icons:** `lucide-react` forms all dynamic SVG logos.
* **Notifications:** `sonner` provides the ultra-smooth, multi-stacking toast alerts appearing in the bottom-right corner when users commit specific DB sync actions.
* **Style Engineering:** `Tailwind CSS v3.4` forces precise structural bounds, utilizing intensive Glassmorphism (`backdrop-blur-md`) layering.
