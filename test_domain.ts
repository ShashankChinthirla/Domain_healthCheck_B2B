import { runFullHealthCheck } from './lib/test-engine';
import * as fs from 'fs';

async function test() {
    const domain = process.argv[2];
    if (!domain) {
        console.error("Please provide a domain.");
        process.exit(1);
    }

    try {
        const report = await runFullHealthCheck(domain);
        fs.writeFileSync('out.json', JSON.stringify(report, null, 2), 'utf8');
        console.log("Wrote out.json");
    } catch (err) {
        console.error("Error:", err);
    }
}

test();
