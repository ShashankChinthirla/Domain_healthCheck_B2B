import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { verifyWebhookSignature } from '@/lib/webhook-utils';

export async function POST(request: NextRequest) {
    try {
        const secret = process.env.WEBHOOK_SECRET;
        if (!secret) {
            console.error('FATAL: WEBHOOK_SECRET is not configured in environment.');
            return NextResponse.json({ error: 'Webhook service misconfigured' }, { status: 500 });
        }

        // 1. Verify HMAC Signature and Timestamp
        const isValid = await verifyWebhookSignature(request, secret);
        if (!isValid) {
            return NextResponse.json({ error: 'Unauthorized: Invalid signature or expired timestamp' }, { status: 401 });
        }

        const body = await request.json();

        // Validate required fields
        if (!body.domain || !body.status || !body.issueCategory) {
            return NextResponse.json({ error: 'Missing required fields: domain, status, issueCategory' }, { status: 400 });
        }

        const client = await clientPromise;
        const db = client.db();
        const collection = db.collection('issue_domains');

        // Construct the update document matching the exact schema from Excel
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateDoc: any = {
            $set: {
                domain: body.domain,
                score: body.score !== undefined ? body.score : null,
                healthStatus: body.healthStatus || null,
                status: body.status, // "Secure" or "At Risk"
                issueCategory: body.issueCategory || 'Clean', // e.g. "No_SPF_AND_DMARC"
                spfFull: body.spfFull || null,
                updatedSpfFull: body.updatedSpfFull || null,
                dmarcFull: body.dmarcFull || null,
                updatedDmarcFull: body.updatedDmarcFull || null,
                issuesDetected: body.issuesDetected || 0,
                timestamp: new Date() // Always update the timestamp when automation runs
            }
        };

        // If the python script passes specific issues (blacklist, dns, etc)
        if (body.issues) {
            updateDoc.$set.issues = body.issues;
        }

        // We use updateMany because multiple users could be tracking the same domain.
        // We do NOT upsert here to prevent creating ghost domains missing an ownerUserId.
        const result = await collection.updateMany(
            { domain: body.domain },
            updateDoc
        );

        return NextResponse.json({
            success: true,
            message: 'Domain updated successfully',
            matchedCount: result.matchedCount,
            modifiedCount: result.modifiedCount
        }, { status: 200 });

    } catch (error) {
        console.error('Webhook error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
