# 💻 B2B Server Setup Guide (PM2)

This project is built to run entirely inside a closed corporate Linux environment using **Node.js** and **PM2** (Process Manager).

---

## Step 1: Install Requirements
Ensure your internal Ubuntu/Debian server has Node.js and the PM2 tool installed.

```bash
# Update Server
sudo apt update

# Install Node (v18 or higher recommended)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 Process Manager globally
sudo npm install -g pm2
```

---

## Step 2: Clone & Install the Project
Download the repository to your `/var/www/` or any designated application folder.

```bash
git clone https://github.com/ShashankChinthirla/Domain_healthCheck_B2B.git
cd Domain_healthCheck_B2B

# Install the necessary packages
npm install
```

---

## Step 3: Configure `.env.local`
The application **will crash** if it cannot connect to MongoDB or find the encryption key. 
Create a file named `.env.local` inside the main root folder.

```env
# 1. MongoDB Connection String (Replace with your actual internal MongoDB URL)
MONGODB_URI="mongodb+srv://user:pass@cluster.mongodb.net/domain_health"

# 2. 32-Character AES-GCM Key (Generate a random 32 character string, DO NOT LOSE THIS)
ENCRYPTION_KEY="your-32-character-super-secret-key"

# 3. Firebase Authentication (Only if you are using Google Firebase to login)
NEXT_PUBLIC_FIREBASE_API_KEY="..."
```

---

## Step 4: Build & Launch
Next.js needs to compile the raw TypeScript strings into optimized, extremely fast JavaScript.

```bash
# Compile the Build
npm run build

# Start the application constantly in the background using PM2
pm2 start npm --name "DomainScanner-B2B" -- start

# Tell PM2 to boot the app automatically if the Server resets
pm2 save
pm2 startup
```

The application is now running securely on `http://localhost:3000` on your internal network! You can access it by typing the server's IP address and port 3000 into your browser (e.g. `192.168.1.50:3000`).
