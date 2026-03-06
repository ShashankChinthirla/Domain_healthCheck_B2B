import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { verifyAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    try {
        const auth = await verifyAuth(req);
        if (!auth.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { mappings } = body;

        if (!mappings || !Array.isArray(mappings) || mappings.length === 0) {
            return NextResponse.json({ error: 'Invalid or missing mappings array.' }, { status: 400 });
        }

        const client = await clientPromise;
        const db = client.db();
        const collection = db.collection('issue_domains');

        // Construct bulk operations
        const bulkOps = mappings.map((mapping: { domain: string, owner: string }) => {
            return {
                updateOne: {
                    filter: {
                        domain: mapping.domain.toLowerCase().trim(),
                        ownerUserId: auth.email // ensure they only update their own domains
                    },
                    update: {
                        $set: { assignedOwner: mapping.owner.trim() }
                    }
                }
            };
        });

        // Execute bulk write
        const result = await collection.bulkWrite(bulkOps, { ordered: false });

        return NextResponse.json({
            success: true,
            matchedCount: result.matchedCount,
            modifiedCount: result.modifiedCount,
            message: `Successfully mapped ${result.modifiedCount} domains.`
        });

    } catch (error: any) {
        console.error("Owner mapping error:", error);
        return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
    }
}
