import { resolve4 } from './lib/dns-cache';

async function main() {
    const DOMAIN_BLACKLISTS = [
        { name: 'Spamhaus DBL', host: 'dbl.spamhaus.org' },
        { name: 'SURBL (multi)', host: 'multi.surbl.org' },
        { name: 'SEM FRESH', host: 'fresh.spameatingmonkey.net' },
        { name: 'SEM URI', host: 'uribl.spameatingmonkey.net' },
        { name: 'SEM URIRED', host: 'urired.spameatingmonkey.net' },
        { name: 'ivmURI', host: 'ivmuri.dnsbl.ivmsip.com' },
        { name: 'NordSpam DBL', host: 'dbl.nordspam.com' },
        { name: 'SORBS RHSBL', host: 'rhsbl.sorbs.net' }
    ];

    const domain = '3fcaptiveservicesdev.com';

    for (const bl of DOMAIN_BLACKLISTS) {
        const lookup = `${domain}.${bl.host}`;
        try {
            const ips = await resolve4(lookup);
            // Ignore 127.0.0.1 (common blocked code) and 127.255.x.x (spamhaus block)
            if (ips.includes('127.0.0.1') || ips.some(ip => ip.startsWith('127.255.'))) {
                console.log(`[BLOCKED/RATE-LIMIT] ${bl.name}: ${ips.join(', ')}`);
                continue;
            }
            if (ips.some(ip => !ip.startsWith('127.'))) {
                console.log(`[WILDCARD-LEAK] ${bl.name}: ${ips.join(', ')}`);
                continue;
            }
            console.log(`[!!! LISTED !!!] ${bl.name}: ${ips.join(', ')}`);
        } catch (e: any) {
            console.log(`[CLEAN] ${bl.name}`);
        }
    }
}

main();
