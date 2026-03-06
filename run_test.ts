import { runFullHealthCheck } from './lib/test-engine';
import fs from 'fs';

async function main() {
    console.log("Starting health check for 3fcaptiveservicesdev.com...");
    const report = await runFullHealthCheck('3fcaptiveservicesdev.com');
    console.log("Writing to debug_report.json...");
    fs.writeFileSync('debug_report.json', JSON.stringify(report.categories.blacklist.tests, null, 2));
}

main().catch(console.error);
