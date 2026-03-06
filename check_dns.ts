import { resolveMx } from './lib/dns-cache';

async function main() {
    try {
        console.log("Resolving MX for 3fcaptiveservicesdev.com...");
        const mx = await resolveMx('3fcaptiveservicesdev.com');
        console.log("MX Records:", mx);
    } catch (e) {
        console.error("DNS MX Error:", e);
    }
}

main().catch(console.error);
