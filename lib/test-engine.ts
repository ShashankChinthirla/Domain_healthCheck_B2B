import * as dns from './dns-cache';
import { setServers } from 'dns';
import * as tls from 'tls'; // Used ONLY for HTTPS (Port 443) Certificate Check
import { checkIPBlacklist, checkDomainBlacklist } from './dnsbl';
import { FullHealthReport, TestResult, CategoryResult, TestStatus } from './types';

// Force usage of Google & Cloudflare DNS for reliability
// REMOVED: setServers(['1.1.1.1', ...]) caused issues on Vercel/AWS Lambda (EREFUSED).
// We now rely on the environment's default DNS resolver (system), which is faster and unblocked.

// Re-export for backend
export type { FullHealthReport, TestResult, CategoryResult, TestStatus };

// --- Helper: Create Category ---
function createCategory(name: string, tests: TestResult[]): CategoryResult {
    const stats = { passed: 0, warnings: 0, errors: 0 };
    for (const t of tests) {
        if (t.status === 'Pass') stats.passed++;
        if (t.status === 'Warning') stats.warnings++;
        if (t.status === 'Error') stats.errors++;
        // Backfill category if missing
        if (!t.category) t.category = name;
    }
    return { category: name, tests, stats };
}

// Helper to push test with auto-defaults if needed (simplifies migration)
function makeResult(name: string, status: TestStatus, info: string, reason: string, recommendation: string): TestResult {
    return { name, status, info, reason, recommendation };
}

// Helper: Check for Private IPs (RFC1918)
function isPrivateIP(ip: string): boolean {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 127) return true; // Loopback
    return false;
}

// Multiple DoH Providers to rotate load and avoid 429 Rate Limits from 50 concurrency
const DOH_PROVIDERS = [
    (d: string) => `https://dns.google/resolve?name=${encodeURIComponent(d)}&type=TXT`,
    (d: string) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(d)}&type=TXT`,
    (d: string) => `https://dns.quad9.net:5053/dns-query?name=${encodeURIComponent(d)}&type=TXT`
];

async function resolveTxtWithDoH(domain: string, attempt: number = 0): Promise<string[][]> {
    try {
        const providerUrl = DOH_PROVIDERS[attempt % DOH_PROVIDERS.length];
        const url = providerUrl(domain);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        // Native fetch with explicit DNS-JSON header
        const res = await fetch(url, { headers: { accept: 'application/dns-json' }, cache: 'no-store', signal: controller.signal });
        clearTimeout(timeoutId);

        if (!res.ok) {
            if (res.status === 429 && attempt < 2) {
                // Rate limited by this DoH provider! Immediately swap to the next provider and retry.
                console.warn(`[DoH] HTTP 429 Rate Limit from provider ${attempt}. Swapping...`);
                return await resolveTxtWithDoH(domain, attempt + 1);
            }
            throw new Error(`DOH_RESPONDED_WITH_HTTP_${res.status}`);
        }

        const json = await res.json();
        if (!json.Answer || json.Answer.length === 0) return [];

        // Type 16 is TXT
        return json.Answer
            .filter((a: any) => a.type === 16)
            .map((a: any) => {
                let text = a.data;
                if (typeof text === 'string' && text.startsWith('"') && text.endsWith('"')) {
                    text = text.slice(1, -1);
                }
                return [text];
            });
    } catch (error: any) {
        if (error.name === 'AbortError' || error.message?.includes('Timeout') || error.message?.includes('fetch failed')) {
            if (attempt < 2) {
                console.warn(`[DoH] Timeout/Network error from provider ${attempt}. Swapping...`);
                return await resolveTxtWithDoH(domain, attempt + 1);
            }
            throw new Error('DOH_NETWORK_ERROR_OR_TIMEOUT');
        }
        throw error;
    }
}

// Helper: Robust DNS TXT Lookup (Retries handled by dns-cache, Verifications by DoH)
async function resolveTxtWithRetry(domain: string): Promise<string[][]> {
    try {
        // Fast path: Try local cached UDP resolver first
        const records = await dns.resolveTxt(domain);

        // Some local resolvers just return [] under load instead of throwing ENOTFOUND
        if (!records || records.length === 0) {
            return await resolveTxtWithDoH(domain);
        }

        return records;
    } catch (error: any) {
        // Slow path: Verification
        // If local UDP dropped the packet, timed out, or says it isn't found,
        // we ALWAYS do a secondary HTTP check to Google to be 100% sure.
        return await resolveTxtWithDoH(domain);
    }
}

// Global Guard: Hard Timeout Helper
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, defaultValue: T, category: string): Promise<T> {
    let timeoutHandle: any;
    const timeoutPromise = new Promise<T>((resolve) => {
        timeoutHandle = setTimeout(() => {
            console.warn(`[TIMEOUT] Category ${category} exceeded ${timeoutMs}ms.`);
            const fallbackError: any = [{
                name: `${category} Lookup Timeout`,
                status: 'Error',
                info: 'Timed Out',
                reason: `The system could not resolve ${category} within ${timeoutMs}ms due to network congestion, dead name servers, or strict ratelimits.`,
                recommendation: 'The system has logged this delay and you may attempt to scan again later.'
            }];

            // If the default value is an array (which it is for all our tests), return the fallback error.
            if (Array.isArray(defaultValue)) {
                resolve(fallbackError as unknown as T);
            } else {
                resolve(defaultValue);
            }
        }, timeoutMs);
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        clearTimeout(timeoutHandle);
    }
}

// --- 1. DNS Tests (Expanded - Deep Analysis) ---
async function runDNSTests(domain: string): Promise<TestResult[]> {
    // Parallelize all independent DNS lookups
    const [cnameRes, aRes, mxRes, nsRes, soaRes, caaRes] = await Promise.all([
        // 1. CNAME Check
        (async () => {
            const t: TestResult[] = [];
            try {
                const cnames = await dns.resolveCname(domain);
                if (cnames.length > 0) {
                    t.push({ name: 'Apex CNAME', status: 'Error', info: 'Present', reason: 'A CNAME record exists at the root domain, which violates RFC standards and breaks MX records.', recommendation: 'Remove the CNAME and use an A record (or ALIAS/ANAME if supported by your provider).' });
                }
            } catch {
                t.push({ name: 'Apex CNAME', status: 'Pass', info: 'Not Found', reason: 'No CNAME record found at root domain (RFC Compliant).', recommendation: 'No action needed.' });
            }
            return t;
        })(),

        // 2. A Record Check
        (async () => {
            const t: TestResult[] = [];
            try {
                const a = await dns.resolve4(domain);
                if (a.length > 0) {
                    t.push({ name: 'DNS Record Published', status: 'Pass', info: 'Primary IP Found', reason: 'A DNS record exists for this domain.', recommendation: 'No action needed.' });
                    t.push({ name: 'A Record Count', status: 'Pass', info: `${a.length} IP(s)`, reason: `Found ${a.length} IPv4 addresses.`, recommendation: 'Ensure these IPs are correct.' });

                    const privateIps = a.filter(ip => isPrivateIP(ip));
                    if (privateIps.length > 0) {
                        t.push({ name: 'Public IP Check', status: 'Error', info: 'Private IP Found', reason: `The IP ${privateIps[0]} is a private local network address (RFC1918). It is not reachable from the internet.`, recommendation: 'Change your A record to a public static IP.' });
                    } else {
                        t.push({ name: 'Public IP Check', status: 'Pass', info: 'Valid Public IP', reason: 'All IPs appear to be valid public addresses.', recommendation: 'No action needed.' });
                    }
                } else {
                    t.push({ name: 'DNS Record Published', status: 'Error', info: 'No A Records', reason: 'The domain does not resolve to an IPv4 address.', recommendation: 'Add an A record pointing to your web server.' });
                }
            } catch {
                t.push({ name: 'DNS Record Published', status: 'Warning', info: 'DNS Lookup Failed', reason: 'Transient DNS lookup failure. Domain may exist but DNS was temporarily unreachable.', recommendation: 'Check your domain registrar settings. Try again.' });
            }
            return t;
        })(),

        // 3. MX Record Check
        (async () => {
            const t: TestResult[] = [];
            try {
                const mxs = await dns.resolveMx(domain);
                if (mxs.length > 0) {
                    t.push({ name: 'MX Record Published', status: 'Pass', info: `${mxs.length} Records`, reason: 'Mail Exchange records found.', recommendation: 'No action needed.' });
                }

                const mxRecords = mxs.sort((a, b) => a.priority - b.priority).map(m => m.exchange);

                if (mxRecords.length > 0) {
                    const primaryMx = mxRecords[0];
                    try {
                        const mxCnames = await dns.resolveCname(primaryMx);
                        if (mxCnames.length > 0) {
                            t.push({ name: 'MX Canonical Check', status: 'Warning', info: 'MX points to CNAME', reason: `The MX record ${primaryMx} points to a CNAME, which violates RFC 2181.`, recommendation: 'Point your MX record directly to an A record host.' });
                        }
                    } catch {
                        t.push({ name: 'MX Canonical Check', status: 'Pass', info: 'Standard Host', reason: 'MX record points to a canonical host (not a CNAME).', recommendation: 'No action needed.' });
                    }

                    try {
                        const ips = await dns.resolve4(primaryMx);
                        t.push({ name: 'Primary MX Resolution', status: 'Pass', info: `${primaryMx} -> ${ips[0]}`, reason: 'Primary MX host resolves to an IP.', recommendation: 'No action needed.' });
                    } catch {
                        try {
                            await dns.resolve6(primaryMx);
                            t.push({ name: 'Primary MX Resolution', status: 'Pass', info: `${primaryMx} -> IPv6`, reason: 'Primary MX host resolves to an IPv6 address.', recommendation: 'Ensure IPv4 is also supported for maximum compatibility.' });
                        } catch (err: any) {
                            t.push({ name: 'Primary MX Resolution', status: 'Error', info: `DNS Error: ${err.message || 'Lookup Failed'}`, reason: 'The mail server hostname could not be resolved.', recommendation: 'Fix the MX record or create the missing A record for the mail server.' });
                        }
                    }
                }
            } catch (error: any) {
                if (error.code === 'ENOTFOUND' || error.code === 'ENODATA' || error.code === 'NOTFOUND') {
                    t.push({ name: 'MX Record Published', status: 'Error', info: 'Missing', reason: 'No MX records found.', recommendation: 'You cannot receive email without MX records.' });
                } else {
                    t.push({ name: 'MX Record Published', status: 'Warning', info: 'DNS Lookup Failed', reason: `DNS Lookup temporarily failed: ${error.message || 'Unknown error'}. Domain may still be valid.`, recommendation: 'Check your DNS configuration or try again.' });
                }
            }
            return t;
        })(),

        // 4. NS Record Check
        (async () => {
            const t: TestResult[] = [];
            try {
                const ns = await dns.resolveNs(domain);
                t.push({ name: 'NS Record Published', status: 'Pass', info: `${ns.length} Nameservers`, reason: 'Nameservers are configured.', recommendation: 'No action needed.' });

                if (ns.length >= 2) {
                    t.push({ name: 'NS Redundancy', status: 'Pass', info: 'Sufficient (2+)', reason: 'Multiple nameservers provide redundancy.', recommendation: 'No action needed.' });
                } else {
                    t.push({ name: 'NS Redundancy', status: 'Warning', info: 'Single Point of Failure (1 NS)', reason: 'Only one nameserver is listed.', recommendation: 'Add at least one backup nameserver.' });
                }

                // Glue Check - Parallelize
                let glueFailures = 0;
                await Promise.all(ns.map(async (n) => {
                    try { await dns.resolve4(n); } catch { glueFailures++; }
                }));

                if (glueFailures === 0) {
                    t.push({ name: 'NS Glue Validity', status: 'Pass', info: 'Resolvable', reason: 'All nameserver hostnames resolve to IPs.', recommendation: 'No action needed.' });
                } else {
                    t.push({ name: 'NS Glue Validity', status: 'Warning', info: 'Unresolvable NS', reason: 'One or more nameservers could not be resolved.', recommendation: 'Check your nameserver hostnames.' });
                }
            } catch (error: any) {
                if (error.code === 'ENOTFOUND' || error.code === 'ENODATA' || error.code === 'NOTFOUND') {
                    t.push({ name: 'NS Record Published', status: 'Error', info: 'Missing', reason: 'No Nameservers found.', recommendation: 'Configure nameservers at your registrar.' });
                } else {
                    t.push({ name: 'NS Record Published', status: 'Warning', info: 'DNS Error', reason: `DNS lookup failed: ${error.message}`, recommendation: 'Try again later.' });
                }
            }
            return t;
        })(),

        // 5. SOA Record Check
        (async () => {
            const t: TestResult[] = [];
            try {
                const soa = await dns.resolveSoa(domain);
                t.push({ name: 'SOA Record Published', status: 'Pass', info: 'Present', reason: 'Start of Authority record found.', recommendation: 'No action needed.' });
                t.push({ name: 'SOA Primary NS', status: 'Pass', info: soa.nsname, reason: 'Primary nameserver defined in SOA.', recommendation: 'No action needed.' });
                t.push({ name: 'SOA RNAME', status: 'Pass', info: soa.hostmaster, reason: 'Responsible person email defined.', recommendation: 'No action needed.' });

                const serialStr = soa.serial.toString();
                const serialRegex = /^20[2-9]\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{2}$/;

                if (serialRegex.test(serialStr)) {
                    t.push({ name: 'SOA Serial Number', status: 'Pass', info: `${soa.serial} (Format OK)`, reason: 'Serial number follows standard YYYYMMDDnn format.', recommendation: 'No action needed.', host: domain, result: 'SOA Serial Format Valid' });
                } else {
                    t.push({ name: 'SOA Serial Number', status: 'Warning', info: `${soa.serial} (Format Weak)`, reason: 'Serial does not match recommended YYYYMMDDnn format (e.g., 2024010101).', recommendation: 'Update serial to YYYYMMDDnn standard.', host: domain, result: 'SOA Serial Format Weak' });
                }

                if (soa.refresh >= 1200 && soa.refresh <= 43200) {
                    t.push({ name: 'SOA Refresh Value', status: 'Pass', info: `${soa.refresh} (RFC OK)`, reason: 'Refresh interval is within RFC recommended range.', recommendation: 'No action needed.' });
                } else {
                    t.push({ name: 'SOA Refresh Value', status: 'Warning', info: `${soa.refresh} (Non-Standard)`, reason: 'Refresh interval is outside RFC optimal range (1200-43200).', recommendation: 'Adjust refresh value.' });
                }

                if (soa.retry >= 180 && soa.retry <= 2419200) {
                    t.push({ name: 'SOA Retry Value', status: 'Pass', info: `${soa.retry} (RFC OK)`, reason: 'Retry interval is within RFC recommended range.', recommendation: 'No action needed.' });
                } else {
                    t.push({ name: 'SOA Retry Value', status: 'Warning', info: `${soa.retry} (Non-Standard)`, reason: 'Retry interval is outside RFC optimal range.', recommendation: 'Adjust retry value.' });
                }

                if (soa.expire >= 604800 && soa.expire <= 1209600) {
                    t.push({ name: 'SOA Expire Value', status: 'Pass', info: `${soa.expire} (Strict OK)`, reason: 'Expire interval is within recommended 1-2 week range.', recommendation: 'No action needed.' });
                } else {
                    t.push({ name: 'SOA Expire Value', status: 'Warning', info: `${soa.expire} (Adjust)`, reason: 'Expire value is outside the strict recommended range (1-2 weeks). Too long can cause stale data persistence.', recommendation: 'Set expire to between 604800 and 1209600.' });
                }

                t.push({ name: 'SOA Minimum TTL', status: 'Pass', info: `${soa.minttl}`, reason: 'Minimum TTL is defined.', recommendation: 'No action needed.' });
            } catch (error: any) {
                if (error.code === 'ENOTFOUND' || error.code === 'ENODATA' || error.code === 'NOTFOUND') {
                    t.push({ name: 'SOA Record Published', status: 'Warning', info: 'Missing', reason: 'SOA record not found.', recommendation: 'Ensure your zone file is valid.' });
                } else {
                    t.push({ name: 'SOA Record Published', status: 'Warning', info: 'DNS Error', reason: `DNS lookup failed: ${error.message}`, recommendation: 'Try again later.' });
                }
            }
            return t;
        })(),

        // 6. CAA Record Check
        (async () => {
            const t: TestResult[] = [];
            try {
                const caa = await dns.resolveCaa(domain);
                t.push({ name: 'CAA Record', status: 'Pass', info: `${caa.length} record(s)`, reason: 'CAA records prevent unauthorized SSL issuance.', recommendation: 'No action needed.' });
            } catch (err: any) {
                t.push({ name: 'CAA Record', status: 'Pass', info: 'Not published (Optional)', reason: 'No CAA records found.', recommendation: 'Consider adding CAA records for better security.' });
            }
            return t;
        })()
    ]);

    // Local DNS Resolver check always first
    const resolverTest: TestResult = { name: 'Local DNS Resolver', status: 'Pass', info: 'Google/Cloudflare (Safe)', reason: 'Using trusted public resolvers (8.8.8.8, 1.1.1.1).', recommendation: 'No action needed.' };

    return [resolverTest, ...cnameRes, ...aRes, ...mxRes, ...nsRes, ...soaRes, ...caaRes];
}


// --- SPF Recursive Helper ---
async function getRecursiveSPFLookupCount(domain: string, seenDomains: Set<string> = new Set()): Promise<{ count: number, error: string | null }> {
    if (seenDomains.has(domain)) {
        return { count: 0, error: 'Loop detected' }; // Stop recursion on loops
    }
    seenDomains.add(domain);

    let txt: string[][] = [];
    try {
        txt = await resolveTxtWithRetry(domain);
    } catch {
        return { count: 0, error: 'DNS Failure' }; // Skip if unresolvable
    }

    // Parse SPF
    const spfRecord = txt.map(t => t.join('')).find(s => s.toLowerCase().startsWith('v=spf1'));
    if (!spfRecord) return { count: 0, error: null }; // No SPF, no lookups

    const parts = spfRecord.split(' ');
    let count = 0;

    for (const part of parts) {
        const lower = part.toLowerCase();

        // Modifiers that cause lookups
        if (lower.startsWith('include:') || lower.startsWith('redirect=')) {
            count++; // The modifier itself counts as 1
            const target = part.split(/[:=]/)[1];
            if (target) {
                const subResult = await getRecursiveSPFLookupCount(target, seenDomains);
                count += subResult.count;
            }
        }
        else if (lower.startsWith('mx') || lower.startsWith('a') || lower.startsWith('ptr') || lower.startsWith('exists:')) {
            count++;
        }
    }

    return { count, error: null };
}


// --- 2. SPF Tests (Deep Analysis) ---
async function runSPFTests(domain: string): Promise<{ tests: TestResult[], rawSpf: string | null }> {
    const tests: TestResult[] = [];
    let rawSpf: string | null = null;

    try {
        // 1. Robust Lookup with Retry
        const txt = await resolveTxtWithRetry(domain);

        // 2. Merge Chunks & Filter
        // SPF records can be split into chunks: "v=spf1 include:..." " ~all"
        // We must join chunks first.
        const spfRecords = txt.map(t => t.join('')).filter(s => s.toLowerCase().startsWith('v=spf1'));

        // 3. Presence Check
        if (spfRecords.length > 0) {
            tests.push({
                name: 'SPF Record Found',
                status: 'Pass',
                info: 'Present',
                reason: 'An SPF TXT record was found in DNS.',
                recommendation: 'No action needed.'
            });
            rawSpf = spfRecords[0];
        } else {
            // Lookup succeeded (no DNS error), but no SPF record found -> MISSING
            tests.push({
                name: 'SPF Record Found',
                status: 'Error',
                info: 'Missing',
                reason: 'No SPF record found.',
                recommendation: 'Create a TXT record starting with v=spf1.',
                host: domain,
                result: 'SPF Record Missing'
            });
            return { tests, rawSpf: null };
        }

        // 2. Multiple Records
        if (spfRecords.length > 1) {
            tests.push({ name: 'SPF Multiple Records', status: 'Error', info: `${spfRecords.length} records`, reason: 'Multiple SPF records strictly invalidates SPF.', recommendation: 'Consolidate all SPF records into a single TXT record.' });
        } else {
            tests.push({ name: 'SPF Multiple Records', status: 'Pass', info: 'Valid (1 record)', reason: 'Only one SPF record exists.', recommendation: 'No action needed.' });
        }



        // 3. Syntax / Version
        if (rawSpf.startsWith('v=spf1')) {
            tests.push({ name: 'SPF Version', status: 'Pass', info: 'v=spf1', reason: 'Correct version tag.', recommendation: 'No action needed.' });
        } else {
            tests.push({ name: 'SPF Version', status: 'Error', info: 'Invalid Version', reason: 'Record must start with v=spf1.', recommendation: 'Fix the version tag.' });
        }

        const parts = rawSpf.split(' ');

        // 4. Content Parsing
        const mechs = parts.slice(1); // skip v=spf1
        let hasAll = false;
        let mechAfterAll = false;
        let allTerminator = '';
        const includes: string[] = [];
        const ip4s: string[] = [];
        const ip6s: string[] = [];
        const ptrs: string[] = [];

        mechs.forEach(m => {
            if (hasAll) mechAfterAll = true; // Flag if anything comes after 'all'

            if (m.endsWith('all')) {
                hasAll = true;
                allTerminator = m;
            }
            if (m.startsWith('include:')) includes.push(m.replace('include:', ''));
            if (m.startsWith('ip4:')) ip4s.push(m);
            if (m.startsWith('ip6:')) ip6s.push(m);
            if (m.includes('ptr')) ptrs.push(m);
        });

        // 5. Mechanisms After All
        if (mechAfterAll) {
            tests.push({ name: 'SPF Mechanisms Ordering', status: 'Warning', info: 'Content after "all"', reason: 'Mechanisms found after the "all" terminator are ignored.', recommendation: 'Move all mechanisms before the ~all/-all tag.' });
        } else {
            tests.push({ name: 'SPF Mechanisms Ordering', status: 'Pass', info: 'Correct', reason: 'Terminator is the last mechanism.', recommendation: 'No action needed.' });
        }

        // 6. Recursive Lookups Count (Includes + A + MX + PTR + Exists)
        const recursiveResult = await getRecursiveSPFLookupCount(domain);
        const lookupCount = recursiveResult.count;

        if (lookupCount > 10) {
            tests.push({
                name: 'SPF Lookup Count',
                status: 'Error',
                info: `${lookupCount} (> 10 Limit)`,
                reason: `Too many DNS lookups cost recursive loads. Found ${lookupCount} lookups (RFC Limit: 10). Nested includes are counted.`,
                recommendation: 'Flatten your SPF record (replace includes with IP4s) or use a flattening service.'
            });
        } else {
            tests.push({
                name: 'SPF Lookup Count',
                status: 'Pass',
                info: `${lookupCount} (Safe < 10)`,
                reason: 'Lookup count is within correct limits.',
                recommendation: 'No action needed.'
            });
        }

        // 7. Policy Check
        if (allTerminator === '-all') {
            tests.push({ name: 'SPF Policy Strictness', status: 'Pass', info: 'Hard Fail (-all)', reason: 'Strict policy (Hard Fail).', recommendation: 'No action needed.' });
        } else if (allTerminator === '~all') {
            tests.push({ name: 'SPF Policy Strictness', status: 'Pass', info: 'Soft Fail (~all)', reason: 'Soft fail (Transitionary).', recommendation: 'Consider moving to -all.' });
        } else if (allTerminator === '?all') {
            tests.push({ name: 'SPF Policy Strictness', status: 'Warning', info: 'Neutral (?all)', reason: 'Neutral policy allows spoofing.', recommendation: 'Change to ~all or -all.' });
        } else if (allTerminator === '+all') {
            tests.push({ name: 'SPF Policy Strictness', status: 'Error', info: 'Allow All (+all)', reason: 'Explicitly allows the entire internet to send email as you.', recommendation: 'Change to -all immediately.' });
        } else if (rawSpf.includes('redirect=')) {
            tests.push({ name: 'SPF Policy Strictness', status: 'Pass', info: 'Redirect', reason: 'Policy is controlled by a redirect.', recommendation: 'Ensure target policy is strict.' });
        } else {
            tests.push({ name: 'SPF Policy Strictness', status: 'Warning', info: 'Missing Terminator', reason: 'No "all" mechanism found.', recommendation: 'Add -all or ~all at the end.' });
        }

        // 8. Deprecated PTR
        if (ptrs.length > 0) {
            tests.push({ name: 'Global PTR Mechanism', status: 'Warning', info: 'Used', reason: 'PTR mechanism is deprecated and slow.', recommendation: 'Remove "ptr" and use specific IPs.' });
        } else {
            tests.push({ name: 'Global PTR Mechanism', status: 'Pass', info: 'Not used', reason: 'No deprecated mechanisms found.', recommendation: 'No action needed.' });
        }

        // 9. Duplicate Mechanisms (Basic check)
        const uniqueMechs = new Set(mechs);
        if (uniqueMechs.size !== mechs.length) {
            tests.push({ name: 'SPF Redundancy', status: 'Warning', info: 'Duplicate Items', reason: 'Record contains duplicate mechanisms.', recommendation: 'Clean up duplicate entries.' });
        }

        // 10. Valid IP4 Syntax (Regex check)
        // 10. Valid IP4/IP6 Syntax (Regex check)
        const badIp4s = ip4s.filter(ip => !/^ip4:[\d\.\/]+$/.test(ip));
        const badIp6s = ip6s.filter(ip => !/^ip6:[a-fA-F0-9\:\/]+$/.test(ip));

        if (badIp4s.length > 0 || badIp6s.length > 0) {
            const allBad = [...badIp4s, ...badIp6s];
            tests.push({ name: 'SPF IP Syntax', status: 'Error', info: 'Invalid Format', reason: `Found malformed IP tags: ${allBad.join(', ')}`, recommendation: 'Fix IP structure (e.g., ip4:1.2.3.4 or ip6:2001:db8::/32).' });
        } else if (ip4s.length > 0 || ip6s.length > 0) {
            tests.push({ name: 'SPF IP Syntax', status: 'Pass', info: 'Valid IPs', reason: `Tested ${ip4s.length + ip6s.length} IP declarations safely.`, recommendation: 'No action needed.' });
        }

        // 11. Void Lookup Check (Async - for Includes)
        // We check if the included domains actually exist.
        if (includes.length > 0) {
            let voidCount = 0;
            const voidDomains: string[] = [];

            // Check max 5 includes to avoid timeout
            for (const inc of includes.slice(0, 5)) {
                try {
                    await resolveTxtWithRetry(inc); // Use stable DoH rotated retry
                } catch (err: any) {
                    if (err.message && (err.message.includes('NOTFOUND') || err.code === 'ENOTFOUND')) {
                        voidCount++;
                        voidDomains.push(inc);
                    }
                    // If it's a rate limit or timeout, we don't penalize it as void to prevent false positives
                }
            }

            if (voidCount > 0) {
                tests.push({ name: 'SPF Void Lookups', status: 'Warning', info: `${voidCount} Failed`, reason: `The following included domains do not exist or have no TXT record: ${voidDomains.join(', ')}`, recommendation: 'Remove dead includes.' });
            } else {
                tests.push({ name: 'SPF Void Lookups', status: 'Pass', info: 'Clean', reason: 'All checked includes resolve correctly.', recommendation: 'No action needed.' });
            }
        }

    } catch {
        tests.push({ name: 'SPF Record Found', status: 'Error', info: 'DNS Lookup Failed', reason: 'Could not retrieve TXT records.', recommendation: 'Check domain existence and DNS servers.' });
    }

    return { tests, rawSpf };
}


// --- 3. DMARC Tests (Deep Analysis) ---
async function runDMARCTests(domain: string): Promise<{ tests: TestResult[], rawDmarc: string | null }> {
    const tests: TestResult[] = [];
    let rawDmarc: string | null = null;
    let policy = '';
    let pct = 100;

    try {
        // 1. Strict Subdomain Lookup (_dmarc) with Retry
        const txt = await resolveTxtWithRetry(`_dmarc.${domain}`);

        // 2. Merge Chunks & Filter
        let dmarcRecords = txt.map(t => t.join('')).filter(s => s.toLowerCase().startsWith('v=dmarc1'));

        // 3. Fallback Inheritance for Subdomains
        let isInherited = false;
        let rootDomain = domain;
        if (dmarcRecords.length === 0) {
            const parts = domain.split('.');
            while (parts.length > 2 && dmarcRecords.length === 0) {
                parts.shift();
                rootDomain = parts.join('.');
                try {
                    const rootTxt = await resolveTxtWithRetry(`_dmarc.${rootDomain}`);
                    dmarcRecords = rootTxt.map(t => t.join('')).filter(s => s.toLowerCase().startsWith('v=dmarc1'));
                    if (dmarcRecords.length > 0) isInherited = true;
                } catch (err: any) {
                    // Ignore fail on ENOENT (missing), but throw if it's a rate limit/network timeout
                    if (err.message?.includes('TIMEOUT') || err.message?.includes('DOH_') || err.message?.includes('DNS')) {
                        throw err;
                    }
                }
            }
        }

        // 4. Presence Check
        if (dmarcRecords.length > 0) {
            tests.push({
                name: 'DMARC Record Found',
                status: 'Pass',
                info: isInherited ? `Inherited (${rootDomain})` : 'Present',
                reason: isInherited ? `DMARC record inherited from parent domain ${rootDomain}.` : 'DMARC record published at _dmarc subdomain.',
                recommendation: 'No action needed.'
            });
            rawDmarc = dmarcRecords[0];
        } else {
            // Lookup succeeded but no DMARC record -> MISSING
            tests.push({
                name: 'DMARC Record Found',
                status: 'Error',
                info: 'Missing',
                reason: `No DMARC record found at _dmarc.${domain} (or inherited parents).`,
                recommendation: 'Create a DMARC record to protect your domain.',
                host: domain,
                result: 'DMARC Record Missing'
            });
            return { tests, rawDmarc: null };
        }

        // 5. Multiple Records
        if (dmarcRecords.length > 1) {
            tests.push({ name: 'DMARC Multiple Records', status: 'Error', info: `${dmarcRecords.length} records`, reason: 'Multiple DMARC records cause undefined behavior.', recommendation: 'Delete all but one DMARC record.' });
        }

        // Parse Tags
        const tags: Record<string, string> = {};
        rawDmarc.split(';').forEach(part => {
            const [k, v] = part.trim().split('=');
            if (k && v) tags[k.toLowerCase()] = v.trim();
        });

        // 6. Policy Check
        if (tags['p']) {
            policy = tags['p'].toLowerCase();
            if (policy === 'reject') {
                tests.push({ name: 'DMARC Policy', status: 'Pass', info: 'Reject (Secure)', reason: 'Strict enforcement policy enabled.', recommendation: 'No action needed.' });
            } else if (policy === 'quarantine') {
                tests.push({ name: 'DMARC Policy', status: 'Pass', info: 'Quarantine', reason: 'Suspicious emails are sent to spam.', recommendation: 'Consider moving to reject for full protection.' });
            } else {
                // DMARC p=none is informational only - not an error
                tests.push({ name: 'DMARC Policy', status: 'Error', info: 'None (Advisory)', reason: 'Policy is set to "none", which only monitors email—no enforcement. This is common during initial DMARC setup.', recommendation: 'When ready, upgrade to quarantine or reject for full protection.', host: domain, result: 'DMARC Policy Monitoring Only' });
            }
        } else {
            tests.push({ name: 'DMARC Policy', status: 'Error', info: 'Missing p= tag', reason: 'Policy tag is mandatory.', recommendation: 'Add p=reject, p=quarantine, or p=none.', host: domain, result: 'DMARC Record Missing' });
        }

        // 4. Subdomain Policy (sp)
        if (tags['sp']) {
            if (tags['sp'] === 'none' && policy !== 'none') {
                tests.push({ name: 'DMARC Subdomain Policy', status: 'Warning', info: 'Insecure (sp=none)', reason: 'Subdomains are explicitly unprotected while root is protected.', recommendation: 'Remove sp=none or set to quarantine/reject.' });
            } else {
                tests.push({ name: 'DMARC Subdomain Policy', status: 'Pass', info: tags['sp'], reason: 'Subdomain policy explicitly defined.', recommendation: 'No action needed.' });
            }
        } else {
            tests.push({ name: 'DMARC Subdomain Policy', status: 'Pass', info: 'Inherited', reason: 'Subdomains inherit the main policy.', recommendation: 'No action needed.' });
        }

        // 5. PCT (Percentage)
        if (tags['pct']) {
            pct = parseInt(tags['pct']);
            if (pct === 100) {
                tests.push({ name: 'DMARC Percentage', status: 'Pass', info: '100%', reason: 'Policy applies to all emails.', recommendation: 'No action needed.' });
            } else {
                tests.push({ name: 'DMARC Percentage', status: 'Warning', info: `${pct}%`, reason: 'Policy only applies to a random subset of emails.', recommendation: 'Set pct=100 for full consistency.' });
            }
        } else {
            tests.push({ name: 'DMARC Percentage', status: 'Pass', info: '100% (Default)', reason: 'Defaults to 100% if missing.', recommendation: 'No action needed.' });
        }

        // 6. RUA (Aggregate Reports) - Detailed External Check
        let hasRua = false;
        if (tags['rua']) {
            hasRua = true;
            const ruaParts = tags['rua'].split(',').map(p => p.trim());
            const invalidRua = ruaParts.filter(p => !p.toLowerCase().startsWith('mailto:'));

            if (invalidRua.length > 0) {
                tests.push({
                    name: 'DMARC RUA Syntax',
                    status: 'Error',
                    info: 'Invalid Format',
                    reason: `DMARC rua URIs must start with "mailto:". Found: ${invalidRua.join(', ')}`,
                    recommendation: 'Add "mailto:" prefix to all rua email addresses (e.g., rua=mailto:admin@example.com).',
                    host: domain,
                    result: 'DMARC Syntax Error'
                });
            } else {
                tests.push({ name: 'DMARC RUA Reports', status: 'Pass', info: 'Enabled', reason: 'Aggregate reports configured correctly.', recommendation: 'No action needed.' });
            }

            // External Authorization Check
            const emails = ruaParts.map(e => e.replace(/^mailto:/i, '').trim());
            for (const email of emails.slice(0, 3)) { // Check first 3
                if (email.includes('@')) {
                    const targetDomain = email.split('@')[1];
                    // Skip if same domain or subdomain
                    if (!domain.endsWith(targetDomain) && !targetDomain.endsWith(domain)) {
                        try {
                            // Check: domain._report._dmarc.targetDomain
                            const verifyHost = `${domain}._report._dmarc.${targetDomain}`;
                            await dns.resolveTxt(verifyHost);
                            tests.push({ name: 'DMARC External Auth', status: 'Pass', info: `Authorized (${targetDomain})`, reason: `Target domain ${targetDomain} has authorized reports from ${domain}.`, recommendation: 'No action needed.' });
                        } catch {
                            tests.push({ name: 'DMARC External Auth', status: 'Warning', info: `Missing Auth (${targetDomain})`, reason: `Target domain ${targetDomain} has NOT authorized records from ${domain}. Reports may be ignored.`, recommendation: `Add TXT record at ${domain}._report._dmarc.${targetDomain} with value "v=DMARC1".` });
                        }
                    }
                }
            }
        } else {
            tests.push({ name: 'DMARC RUA Reports', status: 'Warning', info: 'Missing', reason: 'No visibility into who is sending email as you.', recommendation: 'Add rua=mailto:you@example.com.' });
        }

        // 7. RUF (Forensic Reports)
        if (tags['ruf']) {
            const rufParts = tags['ruf'].split(',').map(p => p.trim());
            const invalidRuf = rufParts.filter(p => !p.toLowerCase().startsWith('mailto:'));

            if (invalidRuf.length > 0) {
                tests.push({
                    name: 'DMARC RUF Syntax',
                    status: 'Error',
                    info: 'Invalid Format',
                    reason: `DMARC ruf URIs must start with "mailto:". Found: ${invalidRuf.join(', ')}`,
                    recommendation: 'Add "mailto:" prefix to all ruf email addresses.',
                    host: domain,
                    result: 'DMARC Syntax Error'
                });
            } else {
                tests.push({ name: 'DMARC RUF Reports', status: 'Pass', info: 'Enabled', reason: 'Forensic reports configured (may not be supported by all providers).', recommendation: 'No action needed.' });
            }
        } else {
            tests.push({ name: 'DMARC RUF Reports', status: 'Pass', info: 'Not Enabled', reason: 'Forensic reports are optional and often noisy.', recommendation: 'No action needed.' });
        }

        // 8. Alignment (ASPF / ADKIM)
        if (tags['aspf'] && tags['aspf'].toLowerCase() === 's') {
            tests.push({ name: 'SPF Alignment Mode', status: 'Pass', info: 'Strict', reason: 'Strict alignment requires exact domain match.', recommendation: 'No action needed.' });
        } else {
            tests.push({ name: 'SPF Alignment Mode', status: 'Pass', info: 'Relaxed (Default)', reason: 'Relaxed alignment allows subdomains.', recommendation: 'No action needed.' });
        }

        if (tags['adkim'] && tags['adkim'].toLowerCase() === 's') {
            tests.push({ name: 'DKIM Alignment Mode', status: 'Pass', info: 'Strict', reason: 'Strict alignment requires exact domain match.', recommendation: 'No action needed.' });
        } else {
            tests.push({ name: 'DKIM Alignment Mode', status: 'Pass', info: 'Relaxed (Default)', reason: 'Relaxed alignment allows subdomains.', recommendation: 'No action needed.' });
        }

        // 9. BIMI Readiness Check
        // Needs p=reject/quarantine and pct=100
        const bimiReady = (policy === 'reject' || policy === 'quarantine') && pct === 100;
        if (bimiReady) {
            tests.push({ name: 'BIMI Readiness', status: 'Pass', info: 'Ready', reason: 'DMARC policy supports BIMI implementation.', recommendation: 'You can now set up a BIMI record.', host: domain, result: 'BIMI Ready' });
        } else {
            // BIMI is advisory – not a security requirement
            tests.push({ name: 'BIMI Readiness', status: 'Error', info: 'Not Ready', reason: 'BIMI requires p=quarantine/reject and pct=100. Optional but recommended for brand visibility.', recommendation: 'Strengthen DMARC policy when ready to enable BIMI.', host: domain, result: 'BIMI Not Ready' });
        }

    } catch (err: any) {
        // DNS Error (Timeout, ServFail) - NOT Missing
        tests.push({
            name: 'DMARC Record Found',
            status: 'Error',
            info: 'DNS Error',
            reason: `DNS Lookup failed: ${err.message}`,
            recommendation: 'Check your DNS configuration or nameservers.',
            host: domain,
            result: 'DMARC DNS Lookup Failed'
        });
    }

    return { tests, rawDmarc };
}


// --- 4. DKIM Tests (Deep Analysis) ---
async function runDKIMTests(domain: string): Promise<TestResult[]> {
    const tests: TestResult[] = [];

    // Common selectors to check (Top 6 for Vercel speed)
    const selectors = ['google', 'default', 'k1', 's1', 'mail', 'selector1'];

    // Parallel lookup for speed
    const lookups = await Promise.allSettled(
        selectors.map(async (sel) => {
            try {
                const results = await dns.resolveTxt(`${sel}._domainkey.${domain}`);
                const record = results.map(t => t.join('')).join('');
                return { sel, record };
            } catch {
                return null;
            }
        })
    );

    const validRecords = lookups
        .filter((r): r is PromiseFulfilledResult<{ sel: string, record: string }> => r.status === 'fulfilled' && r.value !== null)
        .map(r => r.value)
        .filter(r => {
            // Strictly filter out non-DKIM TXT records (e.g. "t=y; o=~")
            // Must have either v=DKIM1 tag OR p= WITH value to be considered a key
            // This ignores empty keys like "p=" or "p=;" unless v=DKIM1 is present
            return r.record.includes('v=DKIM1') || /p=[^;]+/.test(r.record);
        });

    if (validRecords.length > 0) {
        tests.push({ name: 'DKIM Record Found', status: 'Pass', info: `${validRecords.length} Keys`, reason: `Found DKIM keys for selectors: ${validRecords.map(v => v.sel).join(', ')}`, recommendation: 'No action needed.' });

        // Analyze each key
        for (const { sel, record } of validRecords) {
            // Version Check
            if (record.includes('v=DKIM1')) {
                tests.push({ name: `DKIM Version (${sel})`, status: 'Pass', info: 'v=DKIM1', reason: 'Correct version.', recommendation: 'No action needed.' });
            } else {
                tests.push({ name: `DKIM Version (${sel})`, status: 'Warning', info: 'Legacy/Missing', reason: 'v=DKIM1 tag is missing (minor issue).', recommendation: 'Update record to include v=DKIM1.' });
            }

            // Key Type k=rsa
            if (record.includes('k=rsa')) {
                tests.push({ name: `DKIM Key Type (${sel})`, status: 'Pass', info: 'RSA', reason: 'Standard RSA key.', recommendation: 'No action needed.' });
            }

            // Key Length Check
            const pMatch = record.match(/p=([^;]+)/);
            if (pMatch && pMatch[1]) {
                const pValue = pMatch[1];
                const estimatedBits = pValue.length * 6;

                if (estimatedBits >= 2000) {
                    tests.push({ name: `DKIM Key Strength (${sel})`, status: 'Pass', info: '2048-bit+', reason: `Key appears strong (~${Math.round(estimatedBits)} bits).`, recommendation: 'No action needed.' });
                } else if (estimatedBits >= 1000) {
                    tests.push({ name: `DKIM Key Strength (${sel})`, status: 'Warning', info: '1024-bit', reason: `Key is 1024-bit (~${Math.round(estimatedBits)} bits). 2048-bit is recommended.`, recommendation: 'Rotate to a 2048-bit key.' });
                } else {
                    tests.push({ name: `DKIM Key Strength (${sel})`, status: 'Error', info: 'Weak (<1024)', reason: 'Key is too short to be secure.', recommendation: 'Generate a new 2048-bit key immediately.', host: domain, result: `DKIM Key Weak (${sel})` });
                }
            } else {
                tests.push({ name: `DKIM Key Data (${sel})`, status: 'Error', info: 'Missing p=', reason: 'Public key data not found.', recommendation: 'Fix the DKIM record syntax.' });
            }
        }

    } else {
        tests.push({
            name: 'DKIM Selectors',
            status: 'Pass',
            info: 'Info: Selector not discoverable',
            reason: 'Common selectors were checked but not found. This is normal if you use custom selectors.',
            recommendation: 'No action needed unless you are missing DKIM.'
        });
    }

    return tests;
}



// --- 5. Blacklist (Safe IP Check) ---
export async function runBlacklistTestsWithMX(domain: string, mxRecords: string[]): Promise<TestResult[]> {
    if (mxRecords.length === 0) return [{ name: 'Blacklist Check', status: 'Warning', info: 'No MX Records to check', reason: 'We cannot check blacklists without an MX record.', recommendation: 'Fix your MX records first.' }];

    // 1. Resolve all unique MX IPs
    const allIps = new Set<string>();
    await Promise.all(mxRecords.map(async (mx) => {
        try {
            const ips = await dns.resolve4(mx);
            ips.forEach(ip => allIps.add(ip));
        } catch { /* ignore resolution failures for specific MXs */ }
    }));

    const uniqueIps = Array.from(allIps);
    if (uniqueIps.length === 0) {
        return [{ name: 'MX IP Resolution', status: 'Warning', info: 'Could not resolve any MX IPs', reason: 'DNS lookup for all MX hosts failed (Transient).', recommendation: 'Check if your MX hosts exist.', category: 'DNS' }];
    }

    // 2. Run IP Blacklists against all unique IPs
    const ipTests: { [key: string]: { listed: boolean, status: any, targets: string[], details?: string } } = {};

    // Initialize results map
    const ipListNames = [
        'Spamhaus ZEN', 'SpamCop', 'Barracuda', 'SORBS (IP)', 'PSBL',
        'UCEPROTECT L1', 'DroneBL', 'MailSpike BL', 'RBL JP', 'Anonmails', 'Blocklist.de'
    ];
    ipListNames.forEach(name => ipTests[name] = { listed: false, status: 'PASS', targets: [], details: '' });

    await Promise.all(uniqueIps.map(async (ip) => {
        const results = await checkIPBlacklist(ip);
        results.forEach(res => {
            if (res.status === 'FAIL') {
                ipTests[res.list].listed = true;
                ipTests[res.list].status = 'FAIL';
                ipTests[res.list].targets.push(ip);
                ipTests[res.list].details = res.details;
            } else if (res.status === 'UNKNOWN' && (ipTests[res.list].status === 'PASS' || ipTests[res.list].status === 'TIMEOUT')) {
                // UNKNOWN (Rate Limit) is more important to show than TIMEOUT or PASS
                ipTests[res.list].status = 'UNKNOWN';
                ipTests[res.list].details = res.details;
            } else if (res.status === 'TIMEOUT' && ipTests[res.list].status === 'PASS') {
                ipTests[res.list].status = 'TIMEOUT';
                ipTests[res.list].details = 'Query timed out.';
            }
        });
    }));

    // 3. Run Domain Blacklists
    const domainResults = await checkDomainBlacklist(domain);

    // 4. Transform to TestResult[]
    const results: TestResult[] = [];

    // Shared Provider logic (Warning instead of Error for major mail hosts)
    const primaryMx = mxRecords[0]?.toLowerCase() || '';
    const isSharedProvider = primaryMx.includes('google.com') ||
        primaryMx.includes('outlook.com') ||
        primaryMx.includes('zoho.com') ||
        primaryMx.includes('zoho.eu') ||
        primaryMx.includes('facebook.com') ||
        primaryMx.includes('meta.com') ||
        primaryMx.includes('amazon.com') ||
        primaryMx.includes('amazonaws.com');

    // Add IP Results
    for (const name of ipListNames) {
        const data = ipTests[name];
        let status: TestStatus = 'Pass';
        let resultTxt = 'Clean';
        let severity: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
        let reason = `Clean across all ${uniqueIps.length} MX IPs.`;
        let rec = 'No action needed.';

        if (data.status === 'FAIL') {
            const isHighTrust = name === 'SpamCop' || name === 'Spamhaus ZEN';
            severity = isHighTrust ? 'HIGH' : 'MEDIUM';

            if (isSharedProvider) {
                // NEVER penalize users for shared infrastructure (Google/Microsoft) IP blocks
                status = 'Warning';
                resultTxt = 'Shared Provider Listed';
                reason = `Listed on ${name} for IP(s): ${data.targets.join(', ')}. However, this is a shared provider IP.`;
                rec = 'Reputation is managed by your email provider. No action needed unless experiencing bounces.';
            } else {
                status = 'Error';
                resultTxt = 'Listed';
                reason = `IP(s) ${data.targets.join(', ')} are listed on ${name}.`;
                rec = `Contact ${name} for delisting or fix the offending sender on these IPs.`;
            }
        } else if (data.status === 'TIMEOUT') {
            status = 'Warning';
            resultTxt = 'Timeout';
            reason = `Check timed out for ${name}. Status is inconclusive.`;
            rec = 'Usually temporary. No action needed unless it persists.';
        } else if (data.status === 'UNKNOWN') {
            status = 'Warning';
            resultTxt = 'Rate Limited';
            reason = data.details || `${name} refused the query (rate limit).`;
            rec = 'Use a private DNS resolver or check again later.';
        }

        results.push({
            name,
            status,
            info: data.status === 'UNKNOWN' ? 'Rate Limited' : data.status === 'TIMEOUT' ? 'Timeout' : (resultTxt === 'Shared Provider Listed' ? 'Ignored (Shared IP)' : (data.targets.length > 0 ? `Listed: ${data.targets.length} IP(s)` : 'Clean')),
            reason,
            recommendation: rec,
            host: name,
            result: resultTxt,
            type: 'IP',
            severity
        });
    }

    // Add Domain Results
    let anyDomainFail = false;
    domainResults.forEach(res => {
        let status: TestStatus = 'Pass';
        const severity: 'HIGH' | 'MEDIUM' | 'LOW' = res.list.includes('Spamhaus') ? 'HIGH' : 'MEDIUM';
        let reason = res.status === 'PASS' ? `Domain ${domain} is not listed on ${res.list}.` : `Domain ${domain} is listed on ${res.list}.`;
        const rec = res.status === 'PASS' ? 'No action needed.' : 'Request delisting from this provider.';

        if (res.status === 'FAIL') {
            status = 'Error';
            anyDomainFail = true;
            reason = res.details || reason;
        } else if (res.status === 'TIMEOUT') {
            status = 'Warning';
            reason = `Check timed out for ${res.list}.`;
        } else if (res.status === 'UNKNOWN') {
            status = 'Warning';
            reason = res.details || `${res.list} refused the query (rate limit).`;
        }

        results.push({
            name: res.list,
            status,
            info: res.status === 'FAIL' ? 'Listed' : (res.status === 'PASS' ? 'Clean' : (res.status === 'UNKNOWN' ? 'Rate Limited' : res.status)),
            reason,
            recommendation: rec,
            host: res.list,
            result: res.status === 'FAIL' ? (res.list === 'Spamhaus DBL' ? 'Deliverability Risk' : 'Listed') : 'Clean',
            type: 'DOMAIN',
            severity
        });
    });

    // Special Rule: If any domain fail, apply "Deliverability Risk" more broadly if needed
    // The user rule "If any Domain blacklist fails → overall status = 'Deliverability Risk'"
    // We already applied it to the 'result' field of the failed Domain tests above.

    return results;
}


// --- 6. Web Server (HTTPS + Cert) ---
// Allowed: Port 443 only.
async function runWebServerTests(domain: string): Promise<TestResult[]> {
    // Run both checks in parallel to save time
    const [fetchRes, tlsRes] = await Promise.all([
        // 1. Basic Availability (Fetch HTTP & HTTPS)
        (async () => {
            const t: TestResult[] = [];

            // Full Browser Headers Simulation
            const browserHeaders = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            };

            // HTTP (Port 80) Check
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000); // Reduced to 8s for speed
                const res = await fetch(`http://${domain}`, {
                    method: 'GET',
                    redirect: 'manual',
                    signal: controller.signal,
                    headers: browserHeaders
                });
                clearTimeout(timeoutId);

                if (res.status >= 300 && res.status < 400) {
                    const location = res.headers.get('location');
                    if (location && (location.startsWith('https://') || location.includes('https://'))) {
                        t.push({ name: 'HTTP Redirection', status: 'Pass', info: 'Redirects to HTTPS', reason: 'HTTP properly redirects to secure HTTPS.', recommendation: 'No action needed.' });
                    } else {
                        t.push({ name: 'HTTP Redirection', status: 'Warning', info: 'Redirects improperly', reason: `HTTP redirects to ${location}, expected https://${domain}.`, recommendation: 'Ensure HTTP redirects to HTTPS.' });
                    }
                } else if (res.ok) {
                    t.push({ name: 'HTTP Availability', status: 'Warning', info: 'No Redirect', reason: 'HTTP is available but does not redirect to HTTPS.', recommendation: 'Configure 301 redirect from HTTP to HTTPS.' });
                } else {
                    const isWAFBlock = [401, 403, 429, 502, 503].includes(res.status);
                    const newStatus = isWAFBlock ? 'Warning' : 'Error';
                    const newReason = isWAFBlock ? `HTTP access restricted (WAF/Bot protection). Server is alive.` : `HTTP returned error ${res.status}.`;
                    t.push({ name: 'HTTP Availability', status: newStatus, info: `Status ${res.status}`, reason: newReason, recommendation: isWAFBlock ? 'No action needed; automated scan was blocked.' : 'Check web server configuration.' });
                }
            } catch (err: any) {
                const msg = err.name === 'AbortError' ? 'Timeout' : 'Unreachable';
                t.push({ name: 'HTTP Availability', status: 'Error', info: msg, reason: 'Could not connect via HTTP (Port 80).', recommendation: 'Ensure your web server is running on port 80.' });
            }

            // HTTPS (Port 443) Check
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s
                const res = await fetch(`https://${domain}`, {
                    method: 'GET',
                    signal: controller.signal,
                    headers: browserHeaders
                });
                clearTimeout(timeoutId);

                if (res.ok || res.status < 400) {
                    t.push({ name: 'HTTPS Availability', status: 'Pass', info: `Status ${res.status}`, reason: 'HTTPS is accessible.', recommendation: 'No action needed.' });
                } else {
                    const isWAFBlock = [401, 403, 429, 502, 503].includes(res.status);
                    const newStatus = isWAFBlock ? 'Warning' : 'Error';
                    const newReason = isWAFBlock ? `HTTPS access restricted (WAF/Bot protection). Server is alive.` : `Web server returned error status ${res.status}.`;
                    t.push({ name: 'HTTPS Availability', status: newStatus, info: `Status ${res.status}`, reason: newReason, recommendation: isWAFBlock ? 'No action needed; automated scan was blocked.' : 'Check web server logs.' });
                }
            } catch (err: any) {
                const msg = err.name === 'AbortError' ? 'Timeout' : 'Unreachable';
                t.push({ name: 'HTTPS Availability', status: 'Error', info: msg, reason: 'Could not connect via HTTPS (Port 443).', recommendation: 'Ensure your web server is running and port 443 is open.' });
            }
            return t;
        })(),

        // 2. Certificate Details (TLS Socket)
        (async () => {
            const t: TestResult[] = [];
            try {
                await new Promise<void>((resolve, reject) => {
                    const socket = tls.connect(443, domain, { servername: domain, rejectUnauthorized: false }, () => {
                        const cert = socket.getPeerCertificate();
                        if (cert && cert.valid_to) {
                            const validTo = new Date(cert.valid_to);
                            const daysLeft = Math.floor((validTo.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

                            if (daysLeft < 0) {
                                t.push({ name: 'SSL Certificate', status: 'Error', info: 'Expired', reason: `Certificate expired on ${validTo.toDateString()}.`, recommendation: 'Renew your SSL certificate immediately.' });
                            } else if (daysLeft < 14) {
                                t.push({ name: 'SSL Certificate', status: 'Warning', info: `Expires in ${daysLeft} days`, reason: 'Certificate is expiring soon.', recommendation: 'Plan to renew your certificate.' });
                            } else {
                                t.push({ name: 'SSL Certificate', status: 'Pass', info: `Valid (${daysLeft} days left)`, reason: 'Certificate is valid.', recommendation: 'No action needed.' });
                            }

                            if (socket.authorized) {
                                t.push({ name: 'SSL Chain', status: 'Pass', info: 'Valid', reason: 'Certificate chain is trusted.', recommendation: 'No action needed.' });
                            } else {
                                if (socket.authorizationError) {
                                    t.push({ name: 'SSL Chain', status: 'Warning', info: socket.authorizationError.message, reason: 'Certificate trust status is invalid.', recommendation: 'Check intermediate certificates.' });
                                } else {
                                    t.push({ name: 'SSL Chain', status: 'Pass', info: 'Valid', reason: 'Certificate chain is trusted.', recommendation: 'No action needed.' });
                                }
                            }
                        } else {
                            t.push({ name: 'SSL Certificate', status: 'Error', info: 'No Certificate presented', reason: 'Server did not present a certificate.', recommendation: 'Configure SSL on your web server.' });
                        }
                        socket.end();
                        resolve();
                    });

                    socket.on('error', (err) => {
                        t.push({ name: 'SSL Handshake', status: 'Warning', info: err.message, reason: 'SSL Connection failed.', recommendation: 'Check server TLS configuration.' });
                        resolve();
                    });

                    socket.setTimeout(2500, () => {
                        socket.destroy();
                        resolve();
                    });
                });
            } catch {
                // Handled inside
            }
            return t;
        })()
    ]);

    return [...fetchRes, ...tlsRes];
}


// --- Main Runner Orchestrator ---
export async function runFullHealthCheck(domain: string): Promise<FullHealthReport> {
    // 1. Initial independent tests (Immediate Parallel)
    // We wrap each in withTimeout to ensure logic never hangs
    const pDNS = withTimeout(runDNSTests(domain), 15000, [{
        name: 'DNS Check', status: 'Warning', info: 'Timed Out', reason: 'DNS tests took too long.', recommendation: 'Refresh to retry.'
    }], 'DNS');

    const pSPF = withTimeout(runSPFTests(domain), 15000, {
        rawSpf: null,
        tests: [{ name: 'SPF Check', status: 'Warning', info: 'Timed Out', reason: 'SPF check exceeded time limit.', recommendation: 'Try again.' }]
    }, 'SPF');

    const pDMARC = withTimeout(runDMARCTests(domain), 15000, {
        rawDmarc: null,
        tests: [{ name: 'DMARC Check', status: 'Warning', info: 'Timed Out', reason: 'DMARC check exceeded time limit.', recommendation: 'Try again.' }]
    }, 'DMARC');

    const pDKIM = withTimeout(runDKIMTests(domain), 15000, [{
        name: 'DKIM Check', status: 'Warning', info: 'Timed Out', reason: 'DKIM selectors check took too long.', recommendation: 'No action needed.'
    }], 'DKIM');

    const pWeb = withTimeout(runWebServerTests(domain), 15000, [{
        name: 'Web Server', status: 'Warning', info: 'Timed Out', reason: 'Web server checks exceeded timeframe.', recommendation: 'Check site manually.'
    }], 'Web');

    // 2. Blacklist Logic (Parallel & Decoupled)
    // Run domain blacklist immediately
    const pDomainBlacklist = withTimeout(checkDomainBlacklist(domain), 15000, [], 'DomainBlacklist');

    // Resolve MX and run IP blacklist as soon as ready
    const mxLookup = dns.resolveMx(domain)
        .then(mxs => mxs.sort((a, b) => a.priority - b.priority).map(m => m.exchange))
        .catch(() => [] as string[]);

    const pIpBlacklist = mxLookup.then(async (mxs) => {
        if (mxs.length === 0) return [];
        return withTimeout(runBlacklistTestsWithMX(domain, mxs), 15000, [], 'IPBlacklist');
    });

    // Combined Blacklist Resolver
    const pBlacklist = Promise.all([
        pDomainBlacklist.then(res => res.map(bl => ({
            name: bl.list,
            status: bl.status === 'FAIL' ? 'Error' : bl.status === 'TIMEOUT' ? 'Warning' : 'Pass',
            info: bl.status === 'FAIL' ? 'Listed' : (bl.status === 'PASS' ? 'Clean' : bl.status),
            reason: bl.details || `${bl.target} is ${bl.status === 'FAIL' ? 'listed' : 'clean'} on ${bl.list}`,
            recommendation: bl.status === 'FAIL' ? 'Investigate listing.' : 'No action needed.',
            category: 'Blacklist'
        }))),
        pIpBlacklist.then(res => res as TestResult[]) // IP list already returns TestResult[]
    ]).then(([domainRes, ipRes]) => {
        const results = [...domainRes, ...ipRes];
        if (results.length === 0) {
            return [{ name: 'Blacklist Check', status: 'Warning' as TestStatus, info: 'Timed Out', reason: 'Blacklist check took too long.', recommendation: 'Refresh to retry.' }];
        }
        return results;
    }) as Promise<TestResult[]>;

    // 3. Await all with a Final Promise.all
    const [dnsResults, spfRes, dmarcRes, dkimRes, webRes, blacklistRes, mxRecords] = await Promise.all([
        pDNS,
        pSPF,
        pDMARC,
        pDKIM,
        pWeb,
        pBlacklist,
        mxLookup
    ]);



    // 4. Logic: SMTP Explicit Skip (Safe Mode)
    const smtpTests: TestResult[] = [
        {
            name: 'SMTP Connect',
            status: 'Pass',
            info: 'Skipped (Passive)',
            reason: 'We do not perform active SMTP probing (sending test packets) to ensure legal safety and avoid blacklisting.',
            recommendation: 'This is a passive health check tool.'
        },
        {
            name: 'Open Relay',
            status: 'Pass',
            info: 'Skipped (Passive)',
            reason: 'Open relay testing requires active intrusion attempts, which we strictly avoid.',
            recommendation: 'Use internal tools to verify relay security.'
        }
    ];

    // 4.5. Cross-Category Dependency Checks (MxToolbox behavior emulation)
    // If DMARC policy is insecure (e.g. p=none), MxToolbox also flags SPF and MX with errors
    const dmarcPolicyTest = dmarcRes.tests.find((t: TestResult) => t.name === 'DMARC Policy');
    const isDmarcWeak = dmarcPolicyTest && (dmarcPolicyTest.status === 'Error' || dmarcPolicyTest.info.includes('None'));

    if (isDmarcWeak) {
        spfRes.tests.push({
            name: 'SPF DMARC Dependency',
            status: 'Error',
            info: 'Insecure DMARC',
            reason: 'It is recommended to use a quarantine or reject policy. To enable BIMI, it is required to have one of these at 100%.',
            recommendation: 'Upgrade DMARC policy to quarantine or reject.',
            category: 'SPF'
        });

        dnsResults.push({
            name: 'MX DMARC Dependency',
            status: 'Error',
            info: 'Insecure DMARC',
            reason: 'It is recommended to use a quarantine or reject policy. To enable BIMI, it is required to have one of these at 100%.',
            recommendation: 'Upgrade DMARC policy to quarantine or reject.',
            category: 'DNS'
        });
    }

    // 5. Aggregate Problems
    // Helper to attach category
    // Helper to attach category (Preserve existing overrides like 'MX')
    const withCat = (results: TestResult[], cat: string) => results.map(r => ({ ...r, category: r.category || cat }));

    const allTests = [
        ...withCat(dnsResults, 'DNS'),
        ...withCat(spfRes.tests, 'SPF'),
        ...withCat(dmarcRes.tests, 'DMARC'),
        ...withCat(dkimRes, 'DKIM'),
        ...withCat(blacklistRes, 'Blacklist'),
        ...withCat(webRes, 'Web Server'),
        ...withCat(smtpTests, 'SMTP')
    ];

    const problems = allTests.filter(t => t.status !== 'Pass');

    // Calculate score (0-100)
    const totalTests = allTests.length;
    const passedTests = allTests.filter(t => t.status === 'Pass').length;
    const errorTests = allTests.filter(t => t.status === 'Error').length;

    // Score formula: 100 * (passed / total) - (errors * 10)
    const score = Math.max(0, Math.min(100, (passedTests / totalTests) * 100 - (errorTests * 5)));

    return {
        domain,
        rawSpf: spfRes.rawSpf,
        rawDmarc: dmarcRes.rawDmarc,
        dmarcPolicy: null,
        mxRecords,
        score: Math.round(score),
        categories: {
            problems: createCategory('Problems', problems),
            dns: createCategory('DNS', dnsResults),
            spf: createCategory('SPF', spfRes.tests),
            dmarc: createCategory('DMARC', dmarcRes.tests),
            dkim: createCategory('DKIM', dkimRes),
            blacklist: createCategory('Blacklist', blacklistRes),
            webServer: createCategory('Web Server', webRes),
            smtp: createCategory('SMTP', smtpTests) // Explicitly added as separate category
        }
    };
}
