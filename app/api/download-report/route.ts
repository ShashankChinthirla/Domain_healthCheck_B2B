import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import * as xlsx from 'xlsx';
import { verifyAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        // 1. Verify Identity Server-Side via JWT
        let userEmail: string;
        try {
            const auth = await verifyAuth(request);
            userEmail = auth.email;
        } catch (authError) {
            console.error('Auth check failed for report download:', authError);
            return new NextResponse('Unauthorized: Invalid or missing token', { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const email = userEmail; // Derived securely from token

        const issueFilter = searchParams.get('filter') || 'All';
        const query = searchParams.get('query') || '';

        const client = await clientPromise;
        const db = client.db('vercel');
        const collection = db.collection('issue_domains');

        const filter: Record<string, unknown> = { ownerUserId: userEmail };

        if (query) {
            const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            filter.domain = { $regex: escapedQuery, $options: 'i' };
        }

        if (issueFilter && issueFilter !== 'All') {
            filter.issueCategory = issueFilter;
        } else {
            filter.issueCategory = { $ne: 'Needs_Scan' };
        }

        // Fetch all matching domains for the report
        const domains = await collection.find(filter).sort({ domain: 1 }).toArray();

        // Format data for Excel
        const data = domains.map(d => ({
            Domain: d.domain,
            Status: d.status,
            'Issue Category': d.issueCategory || 'Clean',
            'Issues Detected': d.issuesDetected,
            'User': d.ownerUserId || 'Unassigned',
            'SPF Record': d.updatedSpfFull || d.spfFull || 'N/A',
            'DMARC Record': d.updatedDmarcFull || d.dmarcFull || 'N/A',
            'Last Scanned': d.timestamp ? new Date(d.timestamp).toISOString() : 'Unknown'
        }));

        if (data.length === 0) {
            // Provide an empty sheet with headers if no results
            data.push({
                Domain: 'No domains matched the filter.',
                Status: '',
                'Issue Category': '',
                'Issues Detected': 0,
                'User': '',
                'SPF Record': '',
                'DMARC Record': '',
                'Last Scanned': ''
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);
        }

        // Generate Excel Workbook
        const worksheet = xlsx.utils.json_to_sheet(data);

        // Add padding / column widths for better aesthetics
        worksheet['!cols'] = [
            { wch: 40 }, // Domain
            { wch: 15 }, // Status
            { wch: 25 }, // Issue Category
            { wch: 18 }, // Issues Detected
            { wch: 25 }, // User
            { wch: 60 }, // SPF Record
            { wch: 60 }, // DMARC Record
            { wch: 30 }  // Last Scanned
        ];

        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, "Fleet Report");

        // Write to buffer
        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        const filename = `DomainGuard_Report_${issueFilter === 'All' ? 'Full_Fleet' : issueFilter}.xlsx`;

        return new NextResponse(buffer, {
            status: 200,
            headers: {
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            }
        });

    } catch (error) {
        console.error('Error generating report:', error);
        return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 });
    }
}
