import { resolve4 } from './lib/dns-cache';

async function main() {
    try {
        // Test an IP that is definitely CLEAN, like a random AWS IP or Google IP
        // Let's use google.com's IP: 142.250.190.46 -> 46.190.250.142
        const testIp = '46.190.250.142';
        console.log(`Checking clean IP against SpamCop via DoH: ${testIp}.bl.spamcop.net`);
        const ips = await resolve4(`${testIp}.bl.spamcop.net`);
        console.log("SpamCop Returned:", ips);

        console.log(`Checking clean IP against Spamhaus ZEN via DoH: ${testIp}.zen.spamhaus.org`);
        const ips2 = await resolve4(`${testIp}.zen.spamhaus.org`);
        console.log("Spamhaus Returned:", ips2);

        // Also check some domain list
        console.log(`Checking clean Domain against SEM FRESH via DoH: google.com.fresh.spameatingmonkey.net`);
        const ips4 = await resolve4(`google.com.fresh.spameatingmonkey.net`);
        console.log("SEM FRESH Returned:", ips4);
    } catch (e: any) {
        console.error("Error:", e.message || e);
    }
}
main();
