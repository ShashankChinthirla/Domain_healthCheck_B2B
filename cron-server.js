/**
 * Standalone B2B Scheduler
 * Replaces GitHub Actions for production environments.
 * Runs exact same scripts directly on the server via Node.js
 */
const { spawn } = require('child_process');
const schedule = require('node-schedule');

console.log("=========================================");
console.log("🚀 B2B Domain Healthcheck Cron Server Started");
console.log("⏳ Waiting for schedules...");
console.log("=========================================");

// Utility to run scripts like the GitHub action did
function runScript(scriptName) {
    console.log(`\n[${new Date().toISOString()}] ⚡ Triggering script: ${scriptName}`);

    // Using npx tsx just like the workflow
    const process = spawn('npx', ['tsx', scriptName], {
        stdio: 'inherit',
        shell: true
    });

    process.on('close', (code) => {
        console.log(`[${new Date().toISOString()}] ✅ Script ${scriptName} finished with code ${code}`);
    });
}

// ----------------------------------------------------------------------
// JOB 1: Daily Cloudflare Sync & New Domain Scan (From daily_new_domain_scan.yml)
// Original Cron: '0 5 * * *' (05:00 UTC)
// ----------------------------------------------------------------------
schedule.scheduleJob('0 5 * * *', () => {
    console.log("\n--- STARTING JOB: Daily Cloudflare Sync & New Domain Scan ---");
    // Run them sequentially just like the Github Action Steps

    // Stage 1
    console.log("🚀 Pulling newest domains from Cloudflare...");
    const s1 = spawn('npx', ['tsx', 'scripts/sync_cloudflare.ts'], { stdio: 'inherit', shell: true });

    s1.on('close', (code1) => {
        if (code1 !== 0) return console.error('Stage 1 failed');

        // Stage 2
        console.log("👥 Matching domain owners from dfyinfrasetups...");
        const s2 = spawn('npx', ['tsx', 'scripts/sync_users.ts'], { stdio: 'inherit', shell: true });

        s2.on('close', (code2) => {
            if (code2 !== 0) return console.error('Stage 2 failed');

            // Stage 3
            console.log("🛡️ Injecting strict SPF/DMARC and backing up legacy DNS...");
            const s3 = spawn('npx', ['tsx', 'scripts/update_cloudflare_dns.ts'], { stdio: 'inherit', shell: true });

            s3.on('close', (code3) => {
                if (code3 !== 0) return console.error('Stage 3 failed');

                // Stage 4
                console.log("🔍 Veryifying updates with strict deep scanner...");
                const s4 = spawn('npx', ['tsx', 'scripts/rescan_db_v3.ts', '--new'], { stdio: 'inherit', shell: true });
            });
        });
    });
});

// ----------------------------------------------------------------------
// JOB 2: 10-Day Domain Rescan (From recheck_domains.yml)
// Original Cron: '0 0 1,11,21 * *' 
// ----------------------------------------------------------------------
schedule.scheduleJob('0 0 1,11,21 * *', () => {
    console.log("\n--- STARTING JOB: 10-Day Domain Rescan ---");
    runScript('scripts/rescan_db.ts --all');
});

// Keeping the process alive
process.on('SIGINT', function () {
    schedule.gracefulShutdown()
        .then(() => process.exit(0))
});
