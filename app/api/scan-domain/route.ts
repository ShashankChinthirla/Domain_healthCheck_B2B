import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { runFullHealthCheck } from '@/lib/test-engine';
import { ObjectId } from 'mongodb';
import { verifyAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Helpers for Categorization (from rescan_db.ts)
function determineIssueCategory(report: any): string {
    const categories = report.categories || {};
    const spfTests = categories['spf']?.tests || [];
    const dmarcTests = categories['dmarc']?.tests || [];
    const dkimTests = categories['dkim']?.tests || [];
    const webTests = categories['webServer']?.tests || [];
    const blacklistTests = categories['blacklist']?.tests || [];
    const dnsTests = categories['dns']?.tests || [];

    const coreFailedToLoad = [...dnsTests, ...spfTests, ...dmarcTests, ...dkimTests].some((t: any) =>
        t.info === 'Timed Out' ||
        t.info === 'Timeout' ||
        t.info === 'DNS Error' ||
        t.info === 'DNS Lookup Failed' ||
        t.info === 'Failed' ||
        t.info === 'Unreachable' ||
        t.info === 'Rate Limited'
    );
    if (coreFailedToLoad) return 'SYSTEM_TIMEOUT';

    const missingSpf = spfTests.some((t: any) => t.name?.includes('Record Found') && t.status === 'Error' && t.info === 'Missing');
    const missingDmarc = dmarcTests.some((t: any) => t.name?.includes('Record Found') && t.status === 'Error' && t.info === 'Missing');
    const multipleSpf = spfTests.some((t: any) => t.name?.includes('Multiple') && t.status === 'Error');
    const multipleDmarc = dmarcTests.some((t: any) => t.name?.includes('Multiple') && t.status === 'Error');
    const dmarcNone = dmarcTests.some((t: any) => t.name?.includes('Policy') && t.info?.toLowerCase().includes('none'));

    const spfGeneralError = spfTests.some((t: any) => t.status === 'Error' && t.info !== 'Missing' && !t.name?.includes('Multiple'));
    const dmarcGeneralError = dmarcTests.some((t: any) => t.status === 'Error' && t.info !== 'Missing' && !t.name?.includes('Multiple'));

    const dkimErrors = dkimTests.filter((t: any) => t.status === 'Error');

    if (missingSpf && missingDmarc) return 'No_SPF_AND_DMARC';
    if (missingDmarc) return 'No_DMARC_Only';
    if (missingSpf) return 'No_SPF_Only';
    if (multipleSpf) return 'Multiple_SPF';
    if (multipleDmarc) return 'Multiple_DMARC';

    if (spfGeneralError && dmarcGeneralError) return 'No_SPF_AND_DMARC';
    if (dmarcGeneralError) return 'No_DMARC_Only';
    if (spfGeneralError) return 'No_SPF_Only';

    if (dkimErrors.length > 0) return 'DKIM_Issues';
    if (dmarcNone) return 'DMARC_Policy_None';

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

function calculateIssuesCount(report: any): number {
    let count = 0;
    if (!report.categories) return count;

    // Ignore all network noise — these are environmental failures, not security issues
    const ignoredInfos = [
        'Timed Out', 'Timeout', 'DNS Error', 'DNS Lookup Failed',
        'Failed', 'Unreachable', 'Rate Limited', 'TIMEOUT'
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

export async function POST(request: NextRequest) {

    try {
        // 1. Verify Identity Server-Side
        let userEmail: string;
        try {
            const auth = await verifyAuth(request);
            userEmail = auth.email;
        } catch (authError) {
            console.error('Auth check failed for scan-domain:', authError);
            return NextResponse.json({ error: 'Unauthorized: Invalid or missing token' }, { status: 401 });
        }

        const body = await request.json();
        const { domainId, domain } = body;

        if (!domainId && !domain) {
            return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
        }

        const client = await clientPromise;
        const db = client.db('vercel');
        const collection = db.collection('issue_domains');

        // Verify ownership using secure email from token
        const query: any = { ownerUserId: userEmail };
        if (domainId) {
            if (!ObjectId.isValid(domainId)) {
                return NextResponse.json({ error: 'Invalid domain ID format' }, { status: 400 });
            }
            query._id = new ObjectId(domainId);
        } else {
            query.domain = domain;
        }

        const existingDoc = await collection.findOne(query);
        if (!existingDoc) {
            return NextResponse.json({ error: 'Domain not found or unauthorized' }, { status: 404 });
        }

        const targetDomain = existingDoc.domain;

        // Run Health Check (utilizing internal test-engine 15s timeouts)
        const report: any = await runFullHealthCheck(targetDomain);

        const newCategory = determineIssueCategory(report);

        if (newCategory === 'SYSTEM_TIMEOUT') {
            return NextResponse.json({
                success: false,
                message: 'DNS lookup timed out due to rate limits. Try again later.',
                status: 'partial'
            });
        }

        const newIssuesCount = calculateIssuesCount(report);
        const newStatus = newCategory === 'Clean' ? 'Secure' : 'At Risk';
        const spfRecord = report.rawSpf || existingDoc.spfFull;
        const dmarcRecord = report.rawDmarc || existingDoc.dmarcFull;

        await collection.updateOne(
            { _id: existingDoc._id },
            {
                $set: {
                    issueCategory: newCategory,
                    status: newStatus,
                    issuesDetected: newIssuesCount,
                    spfFull: spfRecord?.startsWith('v=') ? spfRecord : existingDoc.spfFull,
                    dmarcFull: dmarcRecord?.startsWith('v=') ? dmarcRecord : existingDoc.dmarcFull,
                    issues: generateIssuesObject(report),
                    healthStatus: 'Scanned via Dashboard',
                    timestamp: new Date()
                }
            }
        );

        return NextResponse.json({
            success: true,
            message: `Domain scanned: ${newStatus === 'Secure' ? 'Clean' : newIssuesCount + ' issues found'}`,
            category: newCategory
        });

    } catch (error: any) {
        console.error('Scan Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
