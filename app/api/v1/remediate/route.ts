import { NextRequest, NextResponse } from 'next/server';
import { runFullHealthCheck } from '@/lib/test-engine';
import { z } from 'zod';

const publicRateLimitMap = new Map<string, { count: number; resetTime: number }>();
const PUBLIC_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const PUBLIC_MAX_REQUESTS_PER_WINDOW = 10;

const remediateSchema = z.object({
    domain: z.string().min(3).regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, "Invalid domain format")
});

// ─── SPF LOGIC (ported from dns_logic.py / BulkResultsTable.tsx) ─────────────
// Rule: Replace -all or ?all with ~all. If missing, generate default.
function generateUpdatedSpf(rawSpf: string | null): string {
    if (!rawSpf) return 'v=spf1 a mx ~all';
    return rawSpf.replace(/-all|\?all/g, '~all');
}

// ─── DMARC LOGIC (ported from dns_logic.py / BulkResultsTable.tsx) ──────────
// Rule: Fix mailto: syntax, upgrade p=none → p=reject, preserve rua/ruf from existing record.
function ensureMailto(val: string): string {
    return val.split(',').map(p => p.trim()).map(p =>
        p.toLowerCase().startsWith('mailto:') ? p : `mailto:${p}`
    ).join(', ');
}

function hasSyntaxError(record: string): boolean {
    const ruaMatch = record.match(/rua=([^;]+)/i);
    if (ruaMatch) {
        const parts = ruaMatch[1].split(',').map(p => p.trim()).filter(Boolean);
        if (parts.some(p => !p.toLowerCase().startsWith('mailto:'))) return true;
    }
    const rufMatch = record.match(/ruf=([^;]+)/i);
    if (rufMatch) {
        const parts = rufMatch[1].split(',').map(p => p.trim()).filter(Boolean);
        if (parts.some(p => !p.toLowerCase().startsWith('mailto:'))) return true;
    }
    return false;
}

function generateUpdatedDmarc(rawDmarc: string | null, domain: string): string {
    // If already strict and no syntax problems, keep as-is
    if (rawDmarc) {
        const isAlreadyStrict = rawDmarc.includes('p=reject') ||
            (rawDmarc.includes('p=quarantine') && rawDmarc.includes('pct=100'));
        if (isAlreadyStrict && !rawDmarc.includes('p=none') && !hasSyntaxError(rawDmarc)) {
            return rawDmarc;
        }
    }

    // Preserve existing rua/ruf if present; otherwise use defaults
    let rua = `mailto:dmarc-reports@${domain}`;
    let rufStr = '';

    if (rawDmarc) {
        const ruaMatch = rawDmarc.match(/rua=([^;]+)/i);
        if (ruaMatch) rua = ensureMailto(ruaMatch[1]);

        const rufMatch = rawDmarc.match(/ruf=([^;]+)/i);
        if (rufMatch) rufStr = ` ruf=${ensureMailto(rufMatch[1])};`;
    }

    return `v=DMARC1; p=reject; sp=reject; pct=100; rua=${rua};${rufStr} adkim=r; aspf=r;`;
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────
async function handleRemediateRequest(request: NextRequest) {
    try {
        // 1. Rate Limiting
        const requestIp = request.headers.get('x-forwarded-for') || (request as any).ip || 'unknown';
        const now = Date.now();
        let rateData = publicRateLimitMap.get(requestIp);
        if (!rateData || now > rateData.resetTime) rateData = { count: 0, resetTime: now + PUBLIC_RATE_LIMIT_WINDOW_MS };
        if (rateData.count >= PUBLIC_MAX_REQUESTS_PER_WINDOW) {
            return NextResponse.json({ error: 'Rate limit exceeded. Try again in a minute.' }, { status: 429 });
        }
        rateData.count++;
        publicRateLimitMap.set(requestIp, rateData);

        // 2. Extract domain
        let rawDomain: string | null = null;
        if (request.method === 'GET') {
            rawDomain = new URL(request.url).searchParams.get('domain');
        } else {
            try {
                const body = await request.json();
                rawDomain = body?.domain ?? null;
            } catch {
                return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
            }
        }
        if (!rawDomain) return NextResponse.json({ error: 'Missing required parameter: domain' }, { status: 400 });

        // 3. Validate
        const validation = remediateSchema.safeParse({ domain: rawDomain });
        if (!validation.success) return NextResponse.json({ error: 'Invalid domain format', details: validation.error.issues }, { status: 400 });
        const domain = validation.data.domain.trim().toLowerCase();

        // 4. Run health check
        const report = await runFullHealthCheck(domain);
        const spfTests = report.categories.spf?.tests || [];
        const dmarcTests = report.categories.dmarc?.tests || [];

        const currentSpf = report.rawSpf || null;
        const currentDmarc = report.rawDmarc || null;

        // 5. Detect if missing
        const spfMissing = spfTests.some(t => t.name === 'SPF Record Found' && t.status === 'Error');
        const dmarcMissing = !dmarcTests.some(t => t.name === 'DMARC Record Found' && t.status === 'Pass');

        // 6. Generate recommended records using the ported logic
        const recommendedSpf = generateUpdatedSpf(spfMissing ? null : currentSpf);
        const recommendedDmarc = generateUpdatedDmarc(dmarcMissing ? null : currentDmarc, domain);

        // 7. Determine if a change is actually needed
        const spfNeedsChange = recommendedSpf !== (currentSpf || '');
        const dmarcNeedsChange = recommendedDmarc !== (currentDmarc || '');

        // 8. Warnings (informational only — user choice)
        const dmarcNoRua = !dmarcMissing && dmarcTests.some(t => t.name === 'DMARC RUA Reports' && t.status !== 'Pass');
        const dmarcExternalAuth = !dmarcMissing && dmarcTests.find(t => t.name === 'DMARC External Auth' && t.status === 'Warning');

        const warnings: string[] = [];
        if (dmarcNoRua) {
            warnings.push("Your DMARC record has no 'rua' tag — you won't receive aggregate reports. Consider adding rua=mailto:you@example.com to your DMARC record.");
        }
        if (dmarcExternalAuth) {
            const targetDomain = dmarcExternalAuth.info?.replace('Missing Auth (', '').replace(')', '');
            warnings.push(`DMARC reports are configured to send to '${targetDomain}'. That domain must add a TXT record at '${domain}._report._dmarc.${targetDomain}' with value 'v=DMARC1;' to authorize this.`);
        }

        return NextResponse.json({
            success: true,
            data: {
                domain,
                timestamp: new Date().toISOString(),
                spf: {
                    status: spfMissing ? 'MISSING' : (spfNeedsChange ? 'NEEDS_UPDATE' : 'OK'),
                    issue: spfMissing
                        ? 'No SPF record found.'
                        : spfNeedsChange
                            ? 'SPF record can be improved (e.g. -all or ?all replaced with ~all).'
                            : null,
                    current_record: currentSpf,
                    recommended_record: spfNeedsChange || spfMissing ? {
                        type: 'TXT',
                        host: '@',
                        value: recommendedSpf
                    } : null
                },
                dmarc: {
                    status: dmarcMissing ? 'MISSING' : (dmarcNeedsChange ? 'NEEDS_UPDATE' : 'OK'),
                    issue: dmarcMissing
                        ? 'No DMARC record found.'
                        : dmarcNeedsChange
                            ? 'DMARC record needs to be made more secure (syntax fix or p=none → p=reject).'
                            : null,
                    current_record: currentDmarc,
                    recommended_record: dmarcNeedsChange || dmarcMissing ? {
                        type: 'TXT',
                        host: '_dmarc',
                        value: recommendedDmarc
                    } : null,
                    warnings: warnings.length > 0 ? warnings : null
                }
            }
        });

    } catch (error: any) {
        console.error('Remediate API Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function GET(request: NextRequest) { return handleRemediateRequest(request); }
export async function POST(request: NextRequest) { return handleRemediateRequest(request); }
