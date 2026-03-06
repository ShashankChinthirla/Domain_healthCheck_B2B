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
        t.info === 'Timed Out' ||
        t.info === 'Timeout' ||
        t.info === 'DNS Error' ||
        t.info === 'DNS Lookup Failed' ||
        t.info === 'Failed' ||
        t.info === 'Unreachable' ||
        t.info === 'Rate Limited'
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

    const blacklistErrors = blacklistTests.filter((t: any) => t.status === 'Error' && !t.info?.includes('Timeout') && t.info !== 'Rate Limited');
    if (blacklistErrors.length > 0) return 'blacklist_issue';

    const webErrors = webTests.filter((t: any) => t.status === 'Error' && !t.info?.includes('Timeout'));
    if (webErrors.length > 0) return 'http_issue';

    return 'Clean';
}

function calculateIssuesCount(report: any): number {
    let count = 0;
    if (!report.categories) return count;

    // Ignore transient network noise — DNS timeouts, rate limits, etc.
    // NOTE: 'Unreachable' is intentionally NOT in this list for web server checks,
    // because an unreachable HTTPS endpoint is a REAL error (not a transient DNS blip).
    const ignoredInfos = [
        'Timed Out', 'Timeout', 'DNS Error', 'DNS Lookup Failed',
        'Failed', 'Rate Limited', 'TIMEOUT', 'Ignored (Shared IP)'
    ];

    // For DNS category only, also ignore 'Unreachable' (unresolvable NS glue is transient)
    const dnsOnlyIgnoredInfos = [...ignoredInfos, 'Unreachable'];

    for (const catKey of Object.keys(report.categories)) {
        const tests = (report.categories as any)[catKey].tests || [];
        const activeIgnoredInfos = catKey === 'dns' ? dnsOnlyIgnoredInfos : ignoredInfos;
        count += tests.filter((t: any) =>
            (t.status === 'Error' || t.status === 'Warning') &&
            !activeIgnoredInfos.some((noise: string) => t.info?.includes(noise))
        ).length;
    }
    return count;
}

function generateIssuesObject(report: any) {
    const issues: any = {};
    const categories = report.categories || {};

    const hasError = (tests: any[]) => tests?.some(t => t.status === 'Error');
    const hasWarning = (tests: any[]) => tests?.some(t => t.status === 'Warning');

    if (hasError(categories['spf']?.tests)) issues.spf = "ERROR: See report for details";
    else if (hasWarning(categories['spf']?.tests)) issues.spf = "WARNING: See report";

    if (hasError(categories['dmarc']?.tests)) issues.dmarc = "ERROR: See report for details";
    else if (hasWarning(categories['dmarc']?.tests)) issues.dmarc = "WARNING: See report";

    if (hasError(categories['dkim']?.tests)) issues.dkim = "ERROR: See report for details";
    else if (hasWarning(categories['dkim']?.tests)) issues.dkim = "WARNING: See report";

    if (hasError(categories['blacklist']?.tests)) issues.blacklist = "ERROR: See report for details";
    else if (hasWarning(categories['blacklist']?.tests)) issues.blacklist = "WARNING: See report";

    if (hasError(categories['webServer']?.tests)) issues.web = "ERROR: See report for details";
    else if (hasWarning(categories['webServer']?.tests)) issues.web = "WARNING: See report";

    return issues;
}

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

// Modified to perform a single attempt, handling retries via the main pool
async function processDomainWithRetry(doc: any, collection: any): Promise<any> {
    try {
        const report = await runFullHealthCheck(doc.domain);
        const newCategory = determineIssueCategory(report);

        if (newCategory === 'SYSTEM_TIMEOUT') {
            return { success: false, retryNeeded: true, domain: doc.domain, error: 'SYSTEM_TIMEOUT' };
        }

        const newIssuesCount = calculateIssuesCount(report);
        const newStatus = newCategory === 'Clean' ? 'Secure' : 'At Risk';

        const spfRecord = report.rawSpf || doc.spfFull;
        const dmarcRecord = report.rawDmarc || doc.dmarcFull;

        await collection.updateOne(
            { _id: doc._id },
            {
                $set: {
                    issueCategory: newCategory,
                    status: newStatus,
                    issuesDetected: newIssuesCount,
                    spfFull: spfRecord?.startsWith('v=') ? spfRecord : doc.spfFull,
                    dmarcFull: dmarcRecord?.startsWith('v=') ? dmarcRecord : doc.dmarcFull,
                    issues: generateIssuesObject(report)
                }
            }
        );
        return { success: true, domain: doc.domain, oldCat: doc.issueCategory, newCat: newCategory };

    } catch (error) {
        return { success: false, retryNeeded: true, domain: doc.domain, error };
    }
}

async function processBatch(documents: any[], collection: any) {
    const promises = documents.map(doc => processDomainWithRetry(doc, collection));
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

        const scanAll = process.argv.includes('--all');
        const scanNew = process.argv.includes('--new');

        let query: Record<string, unknown>;
        if (scanNew) {
            query = { issueCategory: 'Needs_Scan' };
        } else if (scanAll) {
            query = { issueCategory: { $ne: 'Needs_Scan' } };
        } else {
            query = { issueCategory: { $nin: ['Clean', 'Needs_Scan'] } };
        }

        const userArgIndex = process.argv.indexOf('--user');
        if (userArgIndex !== -1 && process.argv.length > userArgIndex + 1) {
            query.ownerUserId = process.argv[userArgIndex + 1];
        }

        const skipArgIndex = process.argv.indexOf('--skip');
        const skipCount = skipArgIndex !== -1 ? parseInt(process.argv[skipArgIndex + 1], 10) : 0;

        // NEW: Matrix Sharding (--shard 0/10)
        let shardIndex = 0;
        let totalShards = 1;
        const shardArgIndex = process.argv.indexOf('--shard');
        if (shardArgIndex !== -1 && process.argv.length > shardArgIndex + 1) {
            const shardMatch = process.argv[shardArgIndex + 1].match(/^(\d+)\/(\d+)$/);
            if (shardMatch) {
                shardIndex = parseInt(shardMatch[1], 10);
                totalShards = parseInt(shardMatch[2], 10);
            }
        }

        const totalToScan = await collection.countDocuments(query);
        const scanTypeText = scanNew ? 'NEW DOMAINS ONLY' : (scanAll ? 'ALL DOMAINS' : 'TARGETED FIX');
        const shardText = totalShards > 1 ? `[SHARD ${shardIndex + 1} OF ${totalShards}]` : '';
        console.log(`\nFound ${totalToScan} domains for evaluation (${scanTypeText}). ${shardText} Skipping first ${skipCount}.\n`);

        const cursor = collection.find(query).skip(skipCount);

        let absoluteIndex = skipCount;
        let processed = 0;
        const BATCH_SIZE = 50; // Massively upgraded concurrency for 10k+ domain queues
        const domainPool: any[] = [];

        // Track retry attempts specifically for each domain ID
        const retryTracker: Record<string, number> = {};
        const MAX_RETRIES = 5;

        // Pre-load all allowed documents to enable pushing failed domains back onto the array
        console.log('Loading domains from DB into memory pool...');
        while (await cursor.hasNext()) {
            const doc = await cursor.next();
            if (!doc) continue;

            if (absoluteIndex % totalShards === shardIndex) {
                domainPool.push(doc);
                retryTracker[doc._id.toString()] = 0;
            }
            absoluteIndex++;
        }

        console.log(`Pool initialized with ${domainPool.length} domains for this shard.`);

        while (domainPool.length > 0) {
            // Take the next batch
            const batch = domainPool.splice(0, BATCH_SIZE);
            const results = await processBatch(batch, collection);

            results.forEach((r: any) => {
                // Find original doc by domain to ensure perfect matching
                const originalDoc = batch.find(d => d.domain === r.domain);
                const docId = originalDoc ? originalDoc._id.toString() : r.domain;

                if (r.success) {
                    processed++;
                    if (r.oldCat !== r.newCat) {
                        console.log(`[UPDATED] ${r.domain} : ${r.oldCat} -> ${r.newCat}`);
                    } else {
                        console.log(`[VERIFIED] ${r.domain} remains ${r.newCat}`);
                    }
                } else if (r.retryNeeded) {
                    retryTracker[docId]++;
                    if (retryTracker[docId] < MAX_RETRIES) {
                        console.log(`[TIMEOUT - RETRY QUEUED ${retryTracker[docId]}/${MAX_RETRIES}] ${r.domain}`);
                        // Push to the VERY END of the pool so we keep processing unblocked domains first
                        if (originalDoc) domainPool.push(originalDoc);
                    } else {
                        processed++;
                        console.log(`[SKIPPED - FAILED AFTER ${MAX_RETRIES} RETRIES] ${r.domain} (Timeout Error)`);
                        // Force update DB so it doesn't stay stuck in 'Needs_Scan' forever
                        if (originalDoc) {
                            collection.updateOne(
                                { _id: originalDoc._id },
                                { $set: { issueCategory: 'Unreachable', status: 'At Risk', issuesDetected: 1, issues: { system: "Domain unreachable or DNS failing consistently" } } }
                            ).catch((err: any) => console.error("Failed to mark unreachable target:", err));
                        }
                    }
                } else {
                    processed++;
                    console.log(`[FAILED] ${r.domain} : ${r.error}`);
                }
            });

            // If the pool consists entirely of retries, we have exhausted our fresh domains.
            // We must enforce a backoff penalty so we don't rapid-fire the same broken domains back immediately.
            const allRetries = domainPool.length > 0 && domainPool.every(d => retryTracker[d._id.toString()] > 0);
            if (allRetries) {
                const jitter = Math.random() * 3000;
                await delay(5000 + jitter);
            }

            // Print progress periodically based on processed count vs initial target
            if (processed % BATCH_SIZE === 0 || domainPool.length === 0) {
                console.log(`Progress: ${processed} / ${totalToScan} (Active Pool Remaining: ${domainPool.length})`);
            }
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
