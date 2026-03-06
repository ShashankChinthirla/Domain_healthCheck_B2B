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

function calculateIssuesCount(report: any): number {
    let count = 0;
    if (!report.categories) return count;

    const ignoredInfos = [
        'Timed Out', 'Timeout', 'DNS Error', 'DNS Lookup Failed',
        'Failed', 'Unreachable', 'Rate Limited', 'TIMEOUT', 'Ignored (Shared IP)'
    ];

    for (const catKey of Object.keys(report.categories)) {
        const tests = report.categories[catKey].tests || [];
        count += tests.filter((t: any) =>
            (t.status === 'Error' || t.status === 'Warning') &&
            !ignoredInfos.some(noise => t.info?.includes(noise))
        ).length;
    }
    return count;
}

function determineIssueCategory(report: any): string {
    const categories = report.categories || {};

    const spfTests = categories['spf']?.tests || [];
    const dmarcTests = categories['dmarc']?.tests || [];
    const dkimTests = categories['dkim']?.tests || [];
    const webTests = categories['webServer']?.tests || [];
    const blacklistTests = categories['blacklist']?.tests || [];
    const dnsTests = categories['dns']?.tests || [];

    const missingSpf = spfTests.some((t: any) => t.name?.includes('Record Found') && t.status === 'Error' && t.info === 'Missing');
    const missingDmarc = dmarcTests.some((t: any) => t.name?.includes('Record Found') && t.status === 'Error' && t.info === 'Missing');

    if (missingSpf && missingDmarc) return 'No_SPF_AND_DMARC';
    if (missingDmarc) return 'No_DMARC_Only';
    if (missingSpf) return 'No_SPF_Only';

    const blacklistErrors = blacklistTests.filter((t: any) => t.status === 'Error' && !t.info?.includes('Timeout') && t.info !== 'Rate Limited');

    if (blacklistErrors.length > 0) return 'blacklist_issue';

    const webErrors = webTests.filter((t: any) => t.status === 'Error' && !t.info?.includes('Timeout') && t.info !== 'Unreachable');
    if (webErrors.length > 0) return 'http_issue';

    return 'Clean';
}

function generateIssuesObject(report: any) {
    const issues: any = {};
    const categories = report.categories || {};

    const hasError = (tests: any[]) => tests?.some(t => t.status === 'Error');
    const hasWarning = (tests: any[]) => tests?.some(t => t.status === 'Warning');

    if (hasError(categories['blacklist']?.tests)) issues.blacklist = "ERROR: See report for details";
    else if (hasWarning(categories['blacklist']?.tests)) issues.blacklist = "WARNING: See report";

    return issues;
}

async function main() {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db("vercel");
    const collection = db.collection("dfyinfrasetups");

    const targetDomain = '3fcaptiveservicesdev.com';
    console.log(`Running health check for ${targetDomain}...`);
    const report = await runFullHealthCheck(targetDomain);

    const count = calculateIssuesCount(report);
    const cat = determineIssueCategory(report);
    const obj = generateIssuesObject(report);

    console.log("Count:", count);
    console.log("Category:", cat);
    console.log("Object:", obj);

    // Update ALL matching domains in the DB (for both users just in case)
    const result = await collection.updateMany(
        { domain: targetDomain },
        {
            $set: {
                issueCategory: cat,
                status: cat === 'Clean' ? 'Secure' : 'At Risk',
                issuesDetected: count,
                issues: obj,
                timestamp: new Date()
            }
        }
    );

    console.log(`Successfully updated ${result.modifiedCount} documents in DB!`);
    await client.close();
}

main().catch(console.error);
