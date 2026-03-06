import { NextRequest, NextResponse } from 'next/server';
import { runFullHealthCheck } from '@/lib/test-engine';
import { z } from 'zod';
import clientPromise from '@/lib/mongodb';

// Simple in-memory IP rate limiter for public unauthenticated endpoints
const publicRateLimitMap = new Map<string, { count: number; resetTime: number }>();
const PUBLIC_RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
const PUBLIC_MAX_REQUESTS_PER_WINDOW = 5; // Very strict for unauthenticated public scans

const scanSchema = z.object({
    domain: z.string().min(3).regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, "Invalid domain format")
});

export async function GET(request: NextRequest) {
    return handleScanRequest(request);
}

export async function POST(request: NextRequest) {
    return handleScanRequest(request);
}

async function handleScanRequest(request: NextRequest) {
    try {
        // 1. IP-Based Rate Limiting
        const requestIp = request.headers.get('x-forwarded-for') || (request as any).ip || 'unknown';
        const now = Date.now();
        let rateData = publicRateLimitMap.get(requestIp);

        if (!rateData || now > rateData.resetTime) {
            rateData = { count: 0, resetTime: now + PUBLIC_RATE_LIMIT_WINDOW_MS };
        }

        if (rateData.count >= PUBLIC_MAX_REQUESTS_PER_WINDOW) {
            return NextResponse.json({
                error: 'Too many requests. Please try again later or upgrade to a developer API key.'
            }, { status: 429 });
        }

        rateData.count++;
        publicRateLimitMap.set(requestIp, rateData);

        // 2. Extract Domain & Options
        let rawDomain: string | null = null;
        let includeAllUrl = true; // Default to true
        let includeAllBody = true; // Default to true

        if (request.method === 'GET') {
            const url = new URL(request.url);
            rawDomain = url.searchParams.get('domain');
            if (url.searchParams.has('include_all')) {
                includeAllUrl = url.searchParams.get('include_all') === 'true';
            }
        } else if (request.method === 'POST') {
            try {
                const body = await request.json();
                rawDomain = body.domain;
                if (body.include_all !== undefined) {
                    includeAllBody = body.include_all === true;
                }
            } catch {
                return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
            }
        }

        const includeAll = includeAllUrl || includeAllBody;

        if (!rawDomain) {
            return NextResponse.json({ error: 'Missing required parameter: domain' }, { status: 400 });
        }

        // 3. Schema Validation
        const validationResult = scanSchema.safeParse({ domain: rawDomain });
        if (!validationResult.success) {
            return NextResponse.json({
                error: 'Invalid domain format',
                details: validationResult.error.issues
            }, { status: 400 });
        }

        const normalizedDomain = validationResult.data.domain.trim().toLowerCase();

        // 4. Run the Engine Check
        // Note: In a production scenario with API keys, we would check if this user
        // owns the domain before scanning, or charge them credits for the scan.
        const report = await runFullHealthCheck(normalizedDomain);

        // Calculate a simple "secure" boolean based on score or critical errors
        const isSecure = report.score >= 80 && report.categories.problems.stats.errors === 0;

        // Optional: Save to audit logs or public scans collection
        try {
            const client = await clientPromise;
            const db = client.db();
            await db.collection('public_api_scans').insertOne({
                timestamp: new Date(),
                domain: normalizedDomain,
                requestIp,
                score: report.score,
                isSecure
            });
        } catch (e) {
            console.error('Failed to log public API scan:', e);
        }

        // Flatten all tests if includeAll is requested
        let allTests: any[] = [];
        if (includeAll) {
            Object.values(report.categories).forEach(cat => {
                // Skip the 'Problems' category itself to avoid duplicates
                if (cat.category !== 'Problems') {
                    allTests = [...allTests, ...cat.tests];
                }
            });
        }

        // 5. Structure the Public JSON Response
        const responseData: any = {
            domain: report.domain,
            timestamp: new Date().toISOString(),
            isSecure,
            score: report.score,
            summary: {
                totalTests: Object.values(report.categories)
                    .filter(c => c.category !== 'Problems')
                    .reduce((acc, cat) => acc + cat.tests.length, 0),
                passed: Object.values(report.categories)
                    .filter(c => c.category !== 'Problems')
                    .reduce((acc, cat) => acc + cat.stats.passed, 0),
                warnings: report.categories.problems.stats.warnings,
                errors: report.categories.problems.stats.errors
            },
            issues: report.categories.problems.tests.map(test => ({
                urgency: test.status, // "Error" or "Warning"
                category: test.category,
                name: test.name,
                info: test.info,
                description: test.reason,
                recommendation: test.recommendation
            }))
        };

        if (includeAll) {
            responseData.allTests = allTests.map(test => ({
                status: test.status,
                category: test.category,
                name: test.name,
                info: test.info,
                description: test.reason,
                recommendation: test.recommendation
            }));
        }

        return NextResponse.json({
            success: true,
            data: responseData
        }, { status: 200 });

    } catch (error: any) {
        console.error('Public API Scan Error:', error);
        return NextResponse.json({ error: 'Internal server error during scan' }, { status: 500 });
    }
}
