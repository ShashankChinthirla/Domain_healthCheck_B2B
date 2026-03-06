import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { isAdmin } from '@/lib/roles';
import { verifyAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        // 1. Verify Identity and Admin Status Server-Side
        let userEmail: string;
        try {
            const auth = await verifyAuth(request);
            userEmail = auth.email;

            // Strict Admin check for system-wide reports
            const adminStatus = await isAdmin(userEmail);
            if (!adminStatus) {
                console.warn(`Non-admin attempt to download automation report: ${userEmail}`);
                return new NextResponse('Forbidden: Admin access required', { status: 403 });
            }
        } catch (authError) {
            console.error('Auth verification failed for automation report:', authError);
            return new NextResponse('Unauthorized: Invalid or missing token', { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const email = userEmail; // Verified and and Admin check passed

        const client = await clientPromise;
        const db = client.db('vercel');

        // Find the most recent report from the automation_reports collection
        const reportsCollection = db.collection('automation_reports');
        const latestReport = await reportsCollection.find().sort({ timestamp: -1 }).limit(1).toArray();

        if (!latestReport || latestReport.length === 0) {
            return NextResponse.json({ error: 'No automation report found.' }, { status: 404 });
        }

        const report = latestReport[0];

        // The field containing the filename based on the schema
        const filename = report.file_name || `automation_report_${new Date().toISOString().split('T')[0]}.xlsx`;

        // file_data contains the BSON Binary object
        const bsonBinaryData = report.file_data;

        // BSON Binary type has a .buffer property representing the underlying bytes
        const buffer = Buffer.isBuffer(bsonBinaryData)
            ? bsonBinaryData
            : bsonBinaryData?.buffer
                ? Buffer.from(bsonBinaryData.buffer) // If it's a BSON Binary type
                : Buffer.from(bsonBinaryData || '', 'base64'); // Fallback in case it ever saves as a plain base64 string

        return new NextResponse(buffer, {
            status: 200,
            headers: {
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            }
        });

    } catch (error) {
        console.error('Error fetching automation report:', error);
        return NextResponse.json({ error: 'Failed to fetch automation report' }, { status: 500 });
    }
}
