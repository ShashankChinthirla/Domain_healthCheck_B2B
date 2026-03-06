import { resolveMx } from './lib/dns-cache';
import { runBlacklistTestsWithMX } from './lib/test-engine';
import fs from 'fs';

async function main() {
    try {
        console.log("Resolving MX...");
        const mxList = await resolveMx('3fcaptiveservicesdev.com');
        const mxs = mxList.sort((a, b) => a.priority - b.priority).map(m => m.exchange);

        console.log("Running IP Blacklists on:", mxs);
        const results = await runBlacklistTestsWithMX('3fcaptiveservicesdev.com', mxs);
        console.log("Writing to debug_ip_blacklist.json...");
        fs.writeFileSync('debug_ip_blacklist.json', JSON.stringify(results, null, 2));
    } catch (e) {
        console.error(e);
    }
}
main();
