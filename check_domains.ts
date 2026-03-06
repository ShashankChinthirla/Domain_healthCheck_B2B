import dns from 'node:dns/promises';

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

async function main() {
    const domain = '3fcaptiveservicesdev.com';

    for (const bl of DOMAIN_BLACKLISTS) {
        const lookup = `${domain}.${bl.host}`;
        try {
            console.log(`Checking ${bl.name}...`);
            const ips = await dns.resolve4(lookup);
            console.log(`[!] LISTED on ${bl.name}: ${ips.join(', ')}`);
        } catch (e: any) {
            if (e.code === 'ENOTFOUND') {
                console.log(`[✓] CLEAN on ${bl.name}`);
            } else {
                console.log(`[?] ERROR on ${bl.name}: ${e.message}`);
            }
        }
    }
}
main();
