# 🩺 Domain & Email Health Checker

![Next.js](https://img.shields.io/badge/Next.js-15-black?style=for-the-badge&logo=next.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=for-the-badge&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.0-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)

> **The MRI Scanner for Your Domains.** 🚀

A powerful, **full-stack diagnostic tool** that performs deep health checks on thousands of domains in seconds. It allows you to analyze security protocols (SPF, DMARC, DKIM), server health, and blacklist status—all running locally on your machine with **zero cost** and **maximized privacy**.

---

## ✨ What Makes This Special?

Unlike simple lookup tools, this application acts as a complete **Bulk Analysis Engine**. It doesn't just read records; it **simulates** real-world email and web traffic to give you 100% accurate results.

### 🔥 Power Features

*   **⚡ Bulk Processing Beast**: Upload an Excel file with **1,000+ domains** and watch them process in real-time.
*   **🛑 Smart Controls**:
    *   **Pause & Resume**: Need a break? Pause the batch instantly and resume exactly where you left off.
    *   **Instant Kill Switch**: Stop the entire operation immediately with zero lag.
*   **🛡️ Deep Security analysis**:
    *   **SPF**: Checks for syntax errors, lookup limits, and strictness.
    *   **DMARC**: Validates policy enforcement (`p=reject`) to prevent spoofing.
    *   **DKIM**: Probes standard keys to ensure email authenticity.
*   **🚫 Blacklist Monitor**: Checks your IP against major anti-spam lists (Spamhaus, Sorbs, Spamcop).
*   **📊 Excel Export**: One-click export of "Clean" vs "Error" domains for easy reporting.

---

## 🚀 How It Works

We bypass expensive 3rd-party APIs by using **Native Node.js Networking**:

1.  **DNS Direct**: We query authoritative nameservers directly for raw, uncached data.
2.  **SMTP Handshake**: We connect to the Mail Server (port 25/587) to "say hello" and verify it's active, without ever sending an email.
3.  **Web Simulation**: We act like a web browser to check if your site is secure (HTTPS) and loads correctly.

All of this happens in **Parallel** (up to 50 concurrent checks) for lightning-fast speeds.

---

## 🛠️ Tech Stack

Built with the latest and greatest web technologies:

*   **Framework**: [Next.js 16](https://nextjs.org/) (App Router)
*   **Language**: [TypeScript](https://www.typescriptlang.org/) (Strict Mode)
*   **Styling**: [Tailwind CSS 4](https://tailwindcss.com/) (Dark Mode UI)
*   **Icons**: [Lucide React](https://lucide.dev/)
*   **Spreadsheets**: [SheetJS](https://sheetjs.com/) (XLSX Processing)

---

## ⚡ Getting Started (Server Deployment for DevOps)

This application is designed to execute as a background service on an internal network/VPS.

### Prerequisites
*   Node.js 18+ installed on your Linux server.
*   PM2 Process Manager (`npm install -g pm2`)
*   *(Optional)* MongoDB Instance if bypassing Firebase logic.

### Installation & Deployment

1.  **Clone the repository to the Server**
    ```bash
    git clone https://github.com/ShashankChinthirla/Domain_healthCheck_B2B.git
    cd Domain_healthCheck_B2B
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Configure Environment Variables**
    Create a `.env.local` file in the root directory. You MUST provide the `ENCRYPTION_KEY` to enable the AES-GCM 256-bit encryption system for 3rd party Cloudflare keys.
    ```env
    # Example 32-byte key:
    ENCRYPTION_KEY="your-super-secret-32-character-key"
    ```

4.  **Production Build**
    Compile the Next.js application:
    ```bash
    npm run build
    ```

5.  **Start the Background Service**
    Launch the app using PM2 to ensure zero-downtime restarts:
    ```bash
    pm2 start npm --name "domain_healthcheck_b2b" -- start
    pm2 save
    ```

6.  **Access App**
    The scanner is now actively listening on `http://localhost:3000`. You can map this via an internal NGINX reverse proxy.

---

## 📚 Technical Documentation

For deep dives into the Architecture, Backend Scaling Limits, or custom Environment configurations, please view the complete suite in the `docs/` folder:

* [Architecture & System Working](docs/Architecture_and_System_Working.md)
* [Frontend Documentation](docs/Frontend_Documentation.md)
* [Backend Security & Networking](docs/Backend_Documentation.md)
* [Issues & Bug Retrospectives](docs/Issues_and_Challenges.md)

---

## 📸 Usage Guide

### Single Check
Simply type a domain (e.g., `google.com`) and hit Enter. You'll get a detailed report card in seconds.

### Bulk Check (The Fun Part)
1.  Click **"Bulk Check"** in the navigation.
2.  Upload an Excel file (`.xlsx`) with a column named `Domain`.
3.  Sit back and watch the progress bar fly! 🚀
4.  Use the **Pause/Resume** buttons if you need to pause the scan.
5.  Click **Export** to save your results.

---

## 🤝 Contributing

We love open source! If you have ideas for new features or faster algorithms, feel free to open an issue or submit a pull request.

---

## 📝 License

This project is licensed under the [MIT License](LICENSE). Check, fix, and secure as many domains as you want!
