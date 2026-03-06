import { MongoClient } from 'mongodb';
import { runFullHealthCheck } from './lib/test-engine';
import path from 'path';
import fs from 'fs';

const envPath = path.resolve(__dirname, '.env.local');
let MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/vercel';
if (!process.env.MONGODB_URI && fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/^MONGODB_URI=(.*)$/m);
    if (match) {
        MONGODB_URI = match[1].trim().replace(/['"]/g, '');
    }
}

const ignoredInfos = [
    'Timed Out', 'Timeout', 'DNS Error', 'DNS Lookup Failed',
    'Failed', 'Unreachable', 'Rate Limited', 'TIMEOUT', 'Ignored (Shared IP)'
];

function calculateIssuesCount(report: any): number {
    let count = 0;
    if (!report.categories) return count;
    for (const catKey of Object.keys(report.categories)) {
        const tests = report.categories[catKey].tests || [];
        count += tests.filter((t: any) =>
            (t.status === 'Error' || t.status === 'Warning') &&
            !ignoredInfos.some(noise => t.info?.includes(noise))
        ).length;
    }
    return count;
}

async function main() {
    const domain = '1orderhik.com';

    // 1. Check what the DB currently has for this domain
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const col = client.db("vercel").collection("dfyinfrasetups");
    const dbRecord = await col.findOne({ domain });
    console.log("=== DB RECORD ===");
    if (dbRecord) {
        console.log("status:", dbRecord.status);
        console.log("issueCategory:", dbRecord.issueCategory);
        console.log("issuesDetected:", dbRecord.issuesDetected);
        console.log("issues:", JSON.stringify(dbRecord.issues));
    } else {
        console.log("No DB record found!");
    }
    await client.close();

    // 2. Run a live check and compare
    console.log("\n=== LIVE ENGINE CHECK ===");
    const report = await runFullHealthCheck(domain);

    // Show all Error tests
    const allTests: any[] = [];
    for (const catKey of Object.keys(report.categories)) {
        const tests = (report.categories as any)[catKey].tests || [];
        for (const t of tests) {
            if (t.status === 'Error') {
                allTests.push({ cat: catKey, name: t.name, status: t.status, info: t.info });
            }
        }
    }

    console.log("Error-level tests found:");
    console.log(JSON.stringify(allTests, null, 2));

    const liveCount = calculateIssuesCount(report);
    console.log("\nLive Engine Issue Count:", liveCount);

    // 3. Write the full live report for comparison
    fs.writeFileSync('diagnose_out.json', JSON.stringify(report.categories, null, 2));
    console.log("Full live report written to diagnose_out.json");
}

main().catch(console.error);
