import { runFullHealthCheck } from '../lib/test-engine';

async function test() {
    const domain = process.argv[2] || 'test-automation-webhook.com';
    const report = await runFullHealthCheck(domain);
    console.log(JSON.stringify(report, null, 2));
}

test();
