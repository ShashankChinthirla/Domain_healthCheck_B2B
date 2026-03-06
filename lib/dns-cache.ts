import { promises as dnsPromises, MxRecord, SoaRecord, CaaRecord } from 'dns';

// Force usage of Google & Cloudflare DNS for reliability was REMOVED because
// setServers(['1.1.1.1', ...]) caused issues on Vercel/AWS Lambda (EREFUSED) and
// local Windows firewalls.
// We now rely on the environment's default DNS resolver (system), which is faster and unblocked.
console.log('[DNS] Using internal system resolvers (Safe Default)');

// Cache structure: Key -> { promise, timestamp, data }
interface CacheEntry<T> {
    promise: Promise<T>;
    timestamp: number;
    data?: T;
    error?: any;
}

const cache = new Map<string, CacheEntry<any>>();
const TTL = 10 * 1000; // 10 Seconds (Matches fast refresh of external tools)

// Global DNS Concurrency Control
// Lowered from 1500 to 250 to prevent packet-drop issues and UDP socket starvation on GitHub Actions instances.
const MAX_CONCURRENT_QUERIES = 250;
let runningQueries = 0;
const queryQueue: ((value: void | PromiseLike<void>) => void)[] = [];

async function acquireSlot(): Promise<void> {
    if (runningQueries < MAX_CONCURRENT_QUERIES) {
        runningQueries++;
        return;
    }
    return new Promise(resolve => queryQueue.push(resolve));
}

function releaseSlot(): void {
    runningQueries--;
    if (queryQueue.length > 0) {
        const next = queryQueue.shift();
        if (next) {
            runningQueries++;
            next();
        }
    }
}

// Dynamic Resolver Logic
let activeResolver = dnsPromises;
if (!process.env.VERCEL) {
    try {
        const { Resolver } = require('dns').promises;
        const customResolver = new (Resolver as any)();
        customResolver.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4', '1.0.0.1']);
        activeResolver = customResolver;
        console.log('[DNS] Using Google/Cloudflare public resolvers to bypass stale OS cache');
    } catch (e) {
        console.log('[DNS] Failed to set custom resolvers, falling back to system default');
    }
} else {
    console.log('[DNS] Vercel environment detected. Using safe system resolvers');
}

/**
 * Generic wrapper to cache DNS calls with global concurrency
 */
async function cachedResolve<T>(
    key: string,
    fnName: keyof typeof dnsPromises,
    args: any[],
    retryCount = 0 // Default to NO retry for bulk speed
): Promise<T> {
    const now = Date.now();
    const headersKey = `DNS:${key}`;

    const entry = cache.get(headersKey);

    // Return valid cached data
    if (entry && (now - entry.timestamp < TTL)) {
        return entry.promise;
    }

    const promise = (async () => {
        let lastError: any;

        for (let attempt = 0; attempt <= retryCount; attempt++) {
            await acquireSlot();

            // TIMEOUT WRAPPER: 2500ms (Strictly optimized for Vercel 10s limit)
            const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('DNS Timeout')), 2500)
            );

            try {
                // Execute using the dynamic resolver
                const result = await Promise.race([
                    (activeResolver as any)[fnName](...args),
                    timeoutPromise
                ]);
                releaseSlot();
                return result;
            } catch (err: any) {
                releaseSlot();
                lastError = err;

                // If custom resolver got refused (e.g., Firewall blocking Port 53),
                // completely abandon custom resolvers globally and fallback to OS System resolver.
                if (activeResolver !== dnsPromises && (err.code === 'EREFUSED' || err.code === 'ECONNREFUSED' || err.message?.includes('socket'))) {
                    console.warn(`[DNS] Core DNS Blocked (Port 53) - Error: ${err.code || err.message}. Permanently falling back to OS system resolver.`);
                    activeResolver = dnsPromises;
                    throw err; // Will retry in the next loop using the system resolver
                }

                const shouldRetry = attempt < retryCount &&
                    (err.message === 'DNS Timeout' || err.code === 'ETIMEOUT' || err.code === 'ESERVFAIL' || err.code === 'EREFUSED');

                if (!shouldRetry) throw err;
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }
        throw lastError;
    })()
        .then(data => {
            cache.set(headersKey, { promise, timestamp: Date.now(), data });
            return data;
        })
        .catch(err => {
            cache.delete(headersKey);
            throw err;
        });

    cache.set(headersKey, { promise, timestamp: now });
    return promise;
}

// Exported wrappers matching used methods
export async function resolve4(hostname: string): Promise<string[]> {
    return cachedResolve(`A:${hostname}`, 'resolve4', [hostname]);
}

export async function resolve6(hostname: string): Promise<string[]> {
    return cachedResolve(`AAAA:${hostname}`, 'resolve6', [hostname]);
}

export async function resolveMx(hostname: string): Promise<MxRecord[]> {
    return cachedResolve(`MX:${hostname}`, 'resolveMx', [hostname]);
}

export async function resolveTxt(hostname: string): Promise<string[][]> {
    return cachedResolve(`TXT:${hostname}`, 'resolveTxt', [hostname]);
}

export async function resolveNs(hostname: string): Promise<string[]> {
    return cachedResolve(`NS:${hostname}`, 'resolveNs', [hostname]);
}

export async function resolveCname(hostname: string): Promise<string[]> {
    return cachedResolve(`CNAME:${hostname}`, 'resolveCname', [hostname]);
}

export async function resolveSoa(hostname: string): Promise<SoaRecord> {
    return cachedResolve(`SOA:${hostname}`, 'resolveSoa', [hostname]);
}

export async function resolveCaa(hostname: string): Promise<CaaRecord[]> {
    return cachedResolve(`CAA:${hostname}`, 'resolveCaa', [hostname]);
}

// setServers is a dummy/unsupported when using native promises directly for some providers,
// but we keep the export for compatibility if needed.
export const setServers = (servers: string[]) => { /* No-op to avoid breaking Vercel */ };