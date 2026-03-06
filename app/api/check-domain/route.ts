import { NextResponse } from 'next/server';
import { runFullHealthCheck } from '@/lib/test-engine';
import clientPromise from '@/lib/mongodb';
import { verifyAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Remove the 9-second Vercel cap — we run locally where there's no function timeout.
// The test-engine already has per-category 15-second timeouts built in, which is the
// right place to handle slow DNS. The outer Promise.race was causing false "Server Timeout"
// errors even on clean domains with mildly slow DNS responses.

export async function POST(request: Request) {
    try {
        // 1. Verify Identity Server-Side
        try {
            await verifyAuth(request);
        } catch (authError) {
            console.error('Auth check failed for check-domain:', authError);
            return NextResponse.json({ error: 'Unauthorized: Invalid or missing token' }, { status: 401 });
        }

        const body = await request.json();
        const { domain } = body;

        if (!domain || typeof domain !== 'string' || !domain.includes('.')) {
            return NextResponse.json({ error: 'Invalid domain format' }, { status: 400 });
        }

        const cleanDomain = domain.trim().toLowerCase();

        // Run the full health check — each category has its own 15s timeout inside the engine.
        const healthReport = await runFullHealthCheck(cleanDomain);

        // Fetch the owner email from MongoDB (optional enrichment)
        let dbEmail = null;
        try {
            const client = await clientPromise;
            const db = client.db("vercel");
            const collection = db.collection("dfyinfrasetups");

            // Escape user-controlled input before passing to RegExp to prevent ReDoS injection
            const escapedDomain = cleanDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const doc = await collection.findOne({
                domain: { $regex: new RegExp(`^${escapedDomain}$`, "i") }
            });

            if (doc) {
                const typedDoc = doc as { user?: string; contactDetails?: { email?: string }[] };
                dbEmail = typedDoc.user || typedDoc.contactDetails?.[0]?.email || null;
            }
        } catch (mongoError) {
            console.error("MongoDB fetch failed (optional):", mongoError);
        }

        return NextResponse.json({
            ...healthReport,
            dbEmail: dbEmail
        });

    } catch (error: unknown) {
        console.error('API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
