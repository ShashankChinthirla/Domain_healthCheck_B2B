import { runFullHealthCheck } from './lib/test-engine';
import fs from 'fs';

async function main() {
    console.log("Running engine exactly like the bulk scanner...");
    const report = await runFullHealthCheck('app3fcaptiveservicesdev.com');
    console.log("Saving full report to full_report.json...");
    fs.writeFileSync('full_report.json', JSON.stringify(report, null, 2));
}

main().catch(console.error);
