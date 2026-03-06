
import * as dns from '../lib/dns-cache';

async function testAmazonDNS() {
    console.log("Testing DNS for amazon.com...");
    try {
        console.time("MX Lookup");
        const mxs = await dns.resolveMx('amazon.com');
        console.timeEnd("MX Lookup");
        console.log("MX Records found:", mxs.length);
        console.log(JSON.stringify(mxs, null, 2));
    } catch (error) {
        console.error("MX Lookup FAILED:", error);
    }
}

testAmazonDNS();
