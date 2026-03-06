import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { z } from 'zod';
import { createHmac, timingSafeEqual, createHash } from 'crypto';

// ============================================================================
// SCHEMA VALIDATION
// ============================================================================
// Strict schema to reject unknown fields and prevent injection
const updateSchema = z.object({
    domain: z.string().min(3),
    status: z.enum(["Secure", "At Risk"]).optional(),
    healthStatus: z.string().optional(),
    score: z.number().min(0).max(100).optional(),
    issuesDetected: z.number().min(0).optional(),
    issueCategory: z.string().optional()
}).strict();

export async function POST(request: NextRequest) {
    const client = await clientPromise;
    const db = client.db();

    // 1. Read request body as text first for HMAC verification
    let bodyText = '';
    try {
        bodyText = await request.text();
    } catch {
        return NextResponse.json({ error: 'Failed to read request body' }, { status: 400 });
    }

    // 2. Parse JSON
    let body;
    try {
        body = JSON.parse(bodyText);
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Pre-extract metadata for logging
    const domain = body.domain ? body.domain.trim().toLowerCase() : 'UNKNOWN_DOMAIN';
    const requestIp = request.headers.get('x-forwarded-for') || (request as any).ip || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';
    const requestPayloadHash = createHash('sha256').update(bodyText).digest('hex');

    try {
        // ==========================================
        // 3. Verify Authentication (HMAC)
        // ==========================================
        const expectedSecret = process.env.B2B_ROCKET_SECRET;
        if (!expectedSecret) {
            console.error('FATAL: B2B_ROCKET_SECRET is not configured.');
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        const authResult = verifyAuth(request, expectedSecret, bodyText);
        if (!authResult.valid) {
            await logAudit(db, {
                actionType: 'API_ACCESS',
                resultStatus: 'FAILED_AUTH',
                domain,
                clientId: authResult.clientId,
                errorMessage: authResult.error,
                requestIp,
                userAgent,
                requestPayloadHash
            });
            return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 });
        }

        const clientId = authResult.clientId!;

        // ==========================================
        // 4. Expected Scale (MongoDB Rate Limiting)
        // ==========================================
        const isRateLimited = await enforceRateLimit(db, clientId);
        if (isRateLimited) {
            await logAudit(db, {
                actionType: 'API_ACCESS',
                resultStatus: 'RATE_LIMITED',
                domain,
                clientId,
                requestIp,
                userAgent,
                requestPayloadHash
            });
            return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
        }

        // ==========================================
        // 5. Input Schema Validation
        // ==========================================
        const validationResult = updateSchema.safeParse(body);
        if (!validationResult.success) {
            await logAudit(db, {
                actionType: 'DOMAIN_UPDATE',
                resultStatus: 'FAILED_VALIDATION',
                domain,
                clientId,
                errorMessage: 'Schema validation failed',
                requestIp,
                userAgent,
                requestPayloadHash
            });
            return NextResponse.json({
                error: 'Invalid request schema',
                details: validationResult.error.issues
            }, { status: 400 });
        }

        const validData = validationResult.data;
        // Domain Normalization
        const normalizedDomain = validData.domain.trim().toLowerCase();

        // ==========================================
        // 6. Domain Authorization
        // ==========================================
        const domainCollection = db.collection('issue_domains');
        const existingDomain = await domainCollection.findOne({ domain: normalizedDomain });

        if (!existingDomain) {
            await logAudit(db, {
                actionType: 'DOMAIN_UPDATE',
                resultStatus: 'FAILED_NOT_PROVISIONED',
                domain: normalizedDomain,
                clientId,
                requestIp,
                userAgent,
                requestPayloadHash
            });
            return NextResponse.json({ error: 'Domain not provisioned in platform' }, { status: 403 });
        }

        // ==========================================
        // 7. Execute the Update
        // ==========================================
        const updateFields: any = { timestamp: new Date() };
        if (validData.status) updateFields.status = validData.status;
        if (validData.healthStatus) updateFields.healthStatus = validData.healthStatus;
        if (validData.score !== undefined) updateFields.score = validData.score;
        if (validData.issuesDetected !== undefined) updateFields.issuesDetected = validData.issuesDetected;
        if (validData.issueCategory) updateFields.issueCategory = validData.issueCategory;

        await domainCollection.updateOne(
            { domain: normalizedDomain },
            { $set: updateFields }
        );

        // ==========================================
        // 8. Auditing (Success)
        // ==========================================
        await logAudit(db, {
            actionType: 'DOMAIN_UPDATE',
            resultStatus: 'SUCCESS',
            domain: normalizedDomain,
            clientId,
            requestIp,
            userAgent,
            requestPayloadHash
        });

        return NextResponse.json({
            success: true,
            message: 'Domain updated successfully',
            updatedFields: Object.keys(updateFields).filter(k => k !== 'timestamp')
        }, { status: 200 });

    } catch (error: any) {
        console.error('B2B Rocket API Error:', error);
        await logAudit(db, {
            actionType: 'DOMAIN_UPDATE',
            resultStatus: 'INTERNAL_ERROR',
            domain,
            errorMessage: error?.message || 'Unknown error',
            requestIp,
            userAgent,
            requestPayloadHash
        });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Validates HMAC signature, timestamp, and extracts client ID.
 */
function verifyAuth(request: NextRequest, secret: string, bodyText: string): { valid: boolean; clientId?: string; error?: string } {
    const clientId = request.headers.get('x-client-id');
    const timestamp = request.headers.get('x-timestamp');
    const signature = request.headers.get('x-signature');

    if (!clientId || !timestamp || !signature) {
        return { valid: false, error: 'Missing required authentication headers (x-client-id, x-timestamp, x-signature)' };
    }

    // 1. Timestamp validation (reject if older than 5 minutes)
    const now = Math.floor(Date.now() / 1000); // Current time in seconds
    const requestTimeRaw = parseInt(timestamp, 10);

    if (isNaN(requestTimeRaw)) {
        return { valid: false, clientId, error: 'Invalid timestamp format' };
    }

    // Handle both ms and seconds optionally, but assume seconds for strictness.
    const requestTime = requestTimeRaw > 2000000000 ? Math.floor(requestTimeRaw / 1000) : requestTimeRaw;

    if (Math.abs(now - requestTime) > 300) {
        return { valid: false, clientId, error: `Request timestamp expired or drift too large` };
    }

    // 2. HMAC Generation: HMAC_SHA256(secret, method + path + body + timestamp)
    const method = request.method;
    const path = request.nextUrl.pathname;
    const payloadToSign = `${method}${path}${bodyText}${timestamp}`;

    const hmac = createHmac('sha256', secret);
    hmac.update(payloadToSign);
    const expectedSignature = hmac.digest('hex');

    // 3. Timing Safe Comparison
    try {
        // Validate hex lengths to prevent Buffer.from throwing errors
        if (signature.length !== expectedSignature.length) {
            return { valid: false, clientId, error: 'Invalid HMAC signature length' };
        }

        const isValid = timingSafeEqual(
            Buffer.from(signature, 'hex'),
            Buffer.from(expectedSignature, 'hex')
        );
        return { valid: isValid, clientId, error: isValid ? undefined : 'Invalid HMAC signature' };
    } catch (e) {
        return { valid: false, clientId, error: 'Invalid signature format (must be valid hex)' };
    }
}

/**
 * Enforces rate limiting using MongoDB atomic increments.
 * Limit: 60 requests per minute per clientId.
 * Returns true if the client is rate limited.
 */
async function enforceRateLimit(db: any, clientId: string): Promise<boolean> {
    try {
        const rateCollection = db.collection('b2b_rate_limits');
        const minuteBucket = Math.floor(Date.now() / 60000); // Window changes every 1 minute
        const LIMIT = 60;

        const result = await rateCollection.findOneAndUpdate(
            { clientId, window: minuteBucket },
            {
                $inc: { count: 1 },
                $setOnInsert: { createdAt: new Date() } // Allows setting up a TTL index on createdAt
            },
            { upsert: true, returnDocument: 'after' }
        );

        const currentCount = result?.count ?? result?.value?.count ?? 1;
        return currentCount > LIMIT;
    } catch (error) {
        console.error('Rate limit error, failing open:', error);
        // Fail open if rate limit DB fails to avoid bricking the API, but log it
        return false;
    }
}

/**
 * Enhanced audit logger with rich context.
 */
async function logAudit(db: any, details: {
    actionType: string;
    resultStatus: string;
    domain: string;
    clientId?: string;
    requestIp?: string;
    userAgent?: string;
    requestPayloadHash?: string;
    errorMessage?: string;
}) {
    try {
        await db.collection('audit_logs').insertOne({
            timestamp: new Date(),
            ...details
        });
    } catch (auditError) {
        console.error('Failed to write audit log:', auditError);
    }
}
