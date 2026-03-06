
import { runFullHealthCheck } from '../lib/test-engine';
import * as fs from 'fs';

const target = 'amazon.com';

async function verify() {
    console.log(`--- Verifying False Positives for ${target} ---`);
    try {
        const report = await runFullHealthCheck(target);
        if (!report || !report.categories) {
            console.error("No report generated");
            return;
        }

        const dnsTests = report.categories['dns']?.tests || [];
        const spfTests = report.categories['spf']?.tests || [];
        const dmarcTests = report.categories['dmarc']?.tests || [];
        const mxTests = report.categories['smtp']?.tests || []; // MX checks often in SMTP or DNS category depending on implementation, checking test-engine.ts it seems they are in 'dns' category check but let's see.
        // Actually looking at test-engine.ts runDNSTests returns a list of tests.
        // And runFullHealthCheck (which I haven't seen yet) presumably assembles them.

        const blacklistTests = report.categories['blacklist']?.tests || [];
        const webServerTests = report.categories['webServer']?.tests || [];

        const output = {
            dns: dnsTests,
            spf: spfTests,
            dmarc: dmarcTests,
            blacklist: blacklistTests,
            webServer: webServerTests,
            full_categories: Object.keys(report.categories)
        };

        fs.writeFileSync('amazon_verify_result.json', JSON.stringify(output, null, 2));
        console.log('Result written to amazon_verify_result.json');

        // Log failures directly to console for quick view
        const failed = dnsTests.filter(t => t.status === 'Error');
        if (failed.length > 0) {
            console.log("\nFAILED DNS TESTS:");
            console.log(failed);
        } else {
            console.log("\nNo DNS Errors found.");
        }

    } catch (err) {
        console.error("FATAL ERROR:", err);
    }
}

verify();
