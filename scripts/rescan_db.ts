/* eslint-disable @typescript-eslint/no-explicit-any */
import { MongoClient } from 'mongodb';
import { runFullHealthCheck } from '../lib/test-engine';
import * as fs from 'fs';
import * as path from 'path';

// Extract MONGODB_URI manually to avoid needing dotenv dependency
const envPath = path.resolve(__dirname, '../.env.local');
let MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/vercel';
if (!process.env.MONGODB_URI && fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/^MONGODB_URI=(.*)$/m);
    if (match) {
        MONGODB_URI = match[1].trim().replace(/['"]/g, '');
    }
}

// Helpers for Categorization
function determineIssueCategory(report: any): string {
    const categories = report.categories || {};

    const spfTests = categories['spf']?.tests || [];
    const dmarcTests = categories['dmarc']?.tests || [];
    const dkimTests = categories['dkim']?.tests || [];
    const webTests = categories['webServer']?.tests || [];
    const blacklistTests = categories['blacklist']?.tests || [];
    const dnsTests = categories['dns']?.tests || [];

    // Safeguard: If core tests failed to load due to network timeouts, skip the domain entirely
    const coreFailedToLoad = [...dnsTests, ...spfTests, ...dmarcTests, ...dkimTests].some((t: any) =>
        t.info === 'Timed Out' || t.info === 'Timeout'
    );

    if (coreFailedToLoad) {
        return 'SYSTEM_TIMEOUT';
    }

    // Must definitively say "Missing", not "DNS Error"
    const missingSpf = spfTests.some((t: any) => t.name?.includes('Record Found') && t.status === 'Error' && t.info === 'Missing');
    const missingDmarc = dmarcTests.some((t: any) => t.name?.includes('Record Found') && t.status === 'Error' && t.info === 'Missing');
    const multipleSpf = spfTests.some((t: any) => t.name?.includes('Multiple') && t.status === 'Error');
    const multipleDmarc = dmarcTests.some((t: any) => t.name?.includes('Multiple') && t.status === 'Error');
    const dmarcNone = dmarcTests.some((t: any) => t.name?.includes('Policy') && t.info?.toLowerCase().includes('none'));

    const spfGeneralError = spfTests.some((t: any) => t.status === 'Error' && t.info !== 'Missing' && !t.name?.includes('Multiple'));
    const dmarcGeneralError = dmarcTests.some((t: any) => t.status === 'Error' && t.info !== 'Missing' && !t.name?.includes('Multiple'));

    const dkimErrors = dkimTests.filter((t: any) => t.status === 'Error');

    // Prioritize Email Deliverability Issues Above Everything Else
    if (missingSpf && missingDmarc) return 'No_SPF_AND_DMARC';
    if (missingDmarc) return 'No_DMARC_Only';
    if (missingSpf) return 'No_SPF_Only';
    if (multipleSpf) return 'Multiple_SPF';
    if (multipleDmarc) return 'Multiple_DMARC';

    // Catch-all for unresolved DNS issues affecting SPF or DMARC
    if (spfGeneralError && dmarcGeneralError) return 'No_SPF_AND_DMARC';
    if (dmarcGeneralError) return 'No_DMARC_Only';
    if (spfGeneralError) return 'No_SPF_Only';

    if (dkimErrors.length > 0) return 'DKIM_Issues';
    if (dmarcNone) return 'DMARC_Policy_None';

    const blacklistErrors = blacklistTests.filter((t: any) => t.status === 'Error' && t.info !== 'Timed Out');
    if (blacklistErrors.length > 0) return 'blacklist_issue';

    const webErrors = webTests.filter((t: any) => t.status === 'Error' && !t.info?.includes('Timeout'));
    if (webErrors.length > 0) return 'http_issue';

    return 'Clean';
}

function calculateIssuesCount(report: any): number {
    let count = 0;
    if (!report.categories) return count;
    for (const catKey of Object.keys(report.categories)) {
        const tests = report.categories[catKey].tests || [];
        count += tests.filter((t: any) => t.status === 'Error' || t.status === 'Warning').length;
    }
    return count;
}

// Batch processor function
async function processBatch(documents: any[], collection: any) {
    const promises = documents.map(async (doc) => {
        try {
            // Run the deep test engine!
            const report = await runFullHealthCheck(doc.domain);

            const newCategory = determineIssueCategory(report);

            if (newCategory === 'SYSTEM_TIMEOUT') {
                return { success: false, domain: doc.domain, error: 'TIMEOUT_OR_DNS_ERROR_SKIPPED' };
            }

            const newIssuesCount = calculateIssuesCount(report);
            const newStatus = newCategory === 'Clean' ? 'Secure' : 'At Risk';

            // Use the raw textual records directly from the report object
            const spfRecord = report.rawSpf || doc.spfFull;
            const dmarcRecord = report.rawDmarc || doc.dmarcFull;

            // Update matching structure
            await collection.updateOne(
                { _id: doc._id },
                {
                    $set: {
                        issueCategory: newCategory,
                        status: newStatus,
                        issuesDetected: newIssuesCount,
                        spfFull: spfRecord?.startsWith('v=') ? spfRecord : doc.spfFull,
                        dmarcFull: dmarcRecord?.startsWith('v=') ? dmarcRecord : doc.dmarcFull,
                    }
                }
            );
            return { success: true, domain: doc.domain, oldCat: doc.issueCategory, newCat: newCategory };
        } catch (error) {
            console.error(`Error processing ${doc.domain}:`, error);
            return { success: false, domain: doc.domain, error };
        }
    });

    return await Promise.all(promises);
}

async function runRescan() {
    console.log('Connecting to MongoDB...');
    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        console.log('Connected.');
        const db = client.db('vercel');
        const collection = db.collection('issue_domains');

        // Scan based on CLI arguments
        const scanAll = process.argv.includes('--all');
        const query = scanAll ? { issueCategory: { $ne: 'Needs_Scan' } } : { issueCategory: { $nin: ['Clean', 'Needs_Scan'] } };

        const totalToScan = await collection.countDocuments(query);
        console.log(`\nFound ${totalToScan} domains for evaluation (${scanAll ? 'ALL DOMAINS' : 'TARGETED FIX'}).\n`);

        const cursor = collection.find(query);

        let processed = 0;
        const BATCH_SIZE = 5; // Lower concurrency to 5 parallel network requests to prevent false timeouts
        let batch = [];

        while (await cursor.hasNext()) {
            const doc = await cursor.next();
            batch.push(doc);

            if (batch.length >= BATCH_SIZE) {
                const results = await processBatch(batch, collection);
                processed += batch.length;

                // Logging changes
                results.forEach((r: any) => {
                    if (r.success && r.oldCat !== r.newCat) {
                        console.log(`[FIXED] ${r.domain} : ${r.oldCat} -> ${r.newCat}`);
                    } else if (!r.success && r.error === 'TIMEOUT_OR_DNS_ERROR_SKIPPED') {
                        console.log(`[SKIPPED - RATE LIMITED] ${r.domain} (Timeout or DNS Error)`);
                    }
                });

                console.log(`Progress: ${processed} / ${totalToScan} (${Math.round((processed / totalToScan) * 100)}%)`);
                batch = [];
            }
        }

        // Process remaining tail
        if (batch.length > 0) {
            const results = await processBatch(batch, collection);
            processed += batch.length;
            results.forEach((r: any) => {
                if (r.success && r.oldCat !== r.newCat) {
                    console.log(`[FIXED] ${r.domain} : ${r.oldCat} -> ${r.newCat}`);
                } else if (!r.success && r.error === 'TIMEOUT_OR_DNS_ERROR_SKIPPED') {
                    console.log(`[SKIPPED - RATE LIMITED] ${r.domain} (Timeout or DNS Error)`);
                }
            });
            console.log(`Progress: ${processed} / ${totalToScan} (100%)`);
        }

        console.log('\n✅ Database Rescan Complete!');

    } catch (error) {
        console.error('Fatal Error:', error);
    } finally {
        await client.close();
        process.exit(0);
    }
}

runRescan();
