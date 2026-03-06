import { resolve4 } from './dns-cache';

export interface BlacklistResult {
    list: string;
    isListed: boolean;
    type: 'IP' | 'DOMAIN';
    target: string;
    details?: string;
    status: 'PASS' | 'FAIL' | 'TIMEOUT' | 'UNKNOWN';
}

// IP Blacklists (11)
export const IP_BLACKLISTS = [
    { name: 'Spamhaus ZEN', host: 'zen.spamhaus.org' },
    { name: 'SpamCop', host: 'bl.spamcop.net' },
    { name: 'Barracuda', host: 'b.barracudacentral.org' },
    { name: 'SORBS (IP)', host: 'dnsbl.sorbs.net' },
    { name: 'PSBL', host: 'psbl.surriel.com' },
    { name: 'UCEPROTECT L1', host: 'dnsbl-1.uceprotect.net' },
    { name: 'DroneBL', host: 'dnsbl.dronebl.org' },
    { name: 'MailSpike BL', host: 'bl.mailspike.net' },
    { name: 'RBL JP', host: 'rbl.jp' },
    { name: 'Anonmails', host: 'spam.dnsbl.anonmails.de' },
    { name: 'Blocklist.de', host: 'bl.blocklist.de' }
];

// Domain Blacklists (8)
export const DOMAIN_BLACKLISTS = [
    { name: 'Spamhaus DBL', host: 'dbl.spamhaus.org' },
    { name: 'SURBL (multi)', host: 'multi.surbl.org' },
    { name: 'SEM FRESH', host: 'fresh.spameatingmonkey.net' },
    { name: 'SEM URI', host: 'uribl.spameatingmonkey.net' },
    { name: 'SEM URIRED', host: 'urired.spameatingmonkey.net' },
    { name: 'ivmURI', host: 'ivmuri.dnsbl.ivmsip.com' },
    { name: 'NordSpam DBL', host: 'dbl.nordspam.com' },
    { name: 'SORBS RHSBL', host: 'rhsbl.sorbs.net' }
];

// 12-hour Cache for Blacklist results
const blCache = new Map<string, { result: boolean, status: any, timestamp: number, details?: string }>();
const BL_TTL = 12 * 60 * 60 * 1000;

/**
 * Normalizes a domain for RHSBL checks (strips leading www. and ensures lowercase)
 */
function normalizeDomain(domain: string): string {
    return domain.toLowerCase().replace(/^www\./, '');
}

async function performLookup(lookupHost: string, listHost: string): Promise<{ isListed: boolean, status: 'PASS' | 'FAIL' | 'UNKNOWN' | 'TIMEOUT', details?: string }> {
    const cacheKey = `${lookupHost}:${listHost}`;
    const cached = blCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < BL_TTL)) {
        return { isListed: cached.result, status: cached.status, details: cached.details };
    }

    try {
        const resultIps = await resolve4(lookupHost);

        // --- PRO-GRADE RETURN CODE HANDLING ---

        // 1. Generic "Service Blocked / Rate Limited" Check
        // Many providers (SEM, SURBL, ivmURI) return 127.0.0.1 to indicate YOUR DNS resolver is blocked.
        // It does NOT mean the target is listed.
        const isCommonBlockedCode = resultIps.includes('127.0.0.1');

        // 2. Spamhaus Specific Blocks
        // 127.255.255.x means the query was refused/blocked by Spamhaus
        const isSpamhausBlocked = listHost.includes('spamhaus.org') &&
            resultIps.some(ip => ip.startsWith('127.255.255.'));

        if (isCommonBlockedCode || isSpamhausBlocked) {
            const details = isSpamhausBlocked ? 'Spamhaus refused query (Rate Limited/Blocked)' : 'Provider refused query (127.0.0.1 - Resolver Blocked)';
            return { isListed: false, status: 'UNKNOWN', details };
        }

        // 3. DNS Wildcard Protection
        // REAL DNSBL results MUST be in the loopback range (127.x.x.x).
        // If it returns anything else (like the domain's own Cloudflare IPs), it's a wildcard "leak".
        const validListingIps = resultIps.filter(ip => ip.startsWith('127.'));
        const isListed = validListingIps.length > 0;

        // CRITICAL: If the result contains ANY non-loopback IP, it's definitely a wildcard leak (Cloudflare/WAF).
        // We reject the entire result as "Clean" in this case.
        const hasWildcardLeak = resultIps.some(ip => !ip.startsWith('127.'));

        if (hasWildcardLeak) {
            return { isListed: false, status: 'PASS' };
        }

        const status = isListed ? 'FAIL' : 'PASS';
        const details = isListed ? `Listed with return code: ${validListingIps.join(', ')}` : undefined;

        blCache.set(cacheKey, { result: isListed, status, timestamp: Date.now(), details });
        return { isListed, status, details };
    } catch (err: any) {
        // ENOTFOUND (NXDOMAIN) = Success (Not listed)
        if (err.code === 'ENOTFOUND' || err.message?.includes('ENOTFOUND')) {
            return { isListed: false, status: 'PASS' };
        }

        // Genuine Timeout
        if (err.message === 'DNS Timeout' || err.code === 'ETIMEOUT') {
            return { isListed: false, status: 'TIMEOUT' };
        }

        // Other errors (SERVFAIL, REFUSED) mean the query failed, not that it's clean
        return { isListed: false, status: 'UNKNOWN', details: `DNS Error: ${err.code || err.message}` };
    }
}

export async function checkIPBlacklist(ip: string): Promise<BlacklistResult[]> {
    const reversedIp = ip.split('.').reverse().join('.');

    return Promise.all(IP_BLACKLISTS.map(async (bl) => {
        const lookup = `${reversedIp}.${bl.host}`;
        const { isListed, status, details } = await performLookup(lookup, bl.host);
        return {
            list: bl.name,
            host: bl.host,
            isListed,
            type: 'IP',
            target: ip,
            status,
            details
        } as any;
    }));
}

export async function checkDomainBlacklist(domain: string): Promise<BlacklistResult[]> {
    const normalized = normalizeDomain(domain);
    return Promise.all(DOMAIN_BLACKLISTS.map(async (bl) => {
        const lookup = `${normalized}.${bl.host}`;
        const { isListed, status, details } = await performLookup(lookup, bl.host);
        return {
            list: bl.name,
            host: bl.host,
            isListed,
            type: 'DOMAIN',
            target: normalized,
            status,
            details
        } as any;
    }));
}
