'use server';

import clientPromise from '@/lib/mongodb';
import { isAdmin } from '@/lib/roles';

import { verifyToken } from '@/lib/auth';

export async function getAdminMetrics(token: string) {
    try {
        const decoded = await verifyToken(token);
        const email = decoded.email;

        if (!(await isAdmin(email))) {
            return { success: false, error: "Unauthorized access" };
        }

        const client = await clientPromise;
        const db = client.db();
        const collection = db.collection('issue_domains');

        // We need to count distinct domains, because if 2 users track 'example.com', there are 2 documents. 
        // Admin panel should show truly distinct metrics.

        // Aggregate counts using pipelines to group by unique domain name
        const statusPipeline = await collection.aggregate([
            {
                $group: {
                    _id: "$domain",
                    isSecure: { $max: { $cond: [{ $eq: ["$status", "Secure"] }, 1, 0] } }
                }
            },
            {
                $group: {
                    _id: null,
                    totalDomains: { $sum: 1 },
                    secureCount: { $sum: "$isSecure" }
                }
            }
        ]).toArray();

        const totalDomains = statusPipeline[0]?.totalDomains || 0;
        const secureCount = statusPipeline[0]?.secureCount || 0;
        const atRiskCount = totalDomains - secureCount;

        // Calculate 'Added Today' dynamically (Distinct domains added within 24 hours)
        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);

        const addedTodayPipeline = await collection.aggregate([
            { $match: { createdAt: { $gte: oneDayAgo } } },
            { $group: { _id: "$domain" } },
            { $count: "uniqueAdded" }
        ]).toArray();

        const addedToday = addedTodayPipeline[0]?.uniqueAdded || 0;

        return {
            totalDomains,
            secureCount,
            atRiskCount,
            addedToday,
            success: true
        };
    } catch (error) {
        console.error("Error fetching metrics:", error);
        return { success: false, error: "Failed to fetch metrics" };
    }
}

export async function getPaginatedDomains(token: string, query = "", issueFilter = "", page = 1, limit = 50) {
    try {
        const decoded = await verifyToken(token);
        const email = decoded.email;

        if (!(await isAdmin(email))) {
            return { success: false, error: "Unauthorized access" };
        }

        const client = await clientPromise;
        const db = client.db();
        const collection = db.collection('issue_domains');

        const filter: any = {};

        if (query) {
            const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            filter.domain = { $regex: escapedQuery, $options: 'i' };
        }

        if (issueFilter && issueFilter !== 'All') {
            switch (issueFilter) {
                case 'Clean':
                    filter.status = 'Secure';
                    // also ensure it doesn't just show Needs_Scan under Clean, although Secure handles it
                    break;
                case 'Needs_Scan':
                    filter.issueCategory = 'Needs_Scan';
                    break;
                case 'blacklist_issue':
                    filter.$or = [{ issueCategory: 'blacklist_issue' }, { 'issues.blacklist': { $regex: 'ERROR|WARNING', $options: 'i' } }];
                    break;
                case 'http_issue':
                    filter.$or = [{ issueCategory: 'http_issue' }, { 'issues.web': { $regex: 'ERROR', $options: 'i' } }];
                    break;
                case 'No_SPF_AND_DMARC':
                    filter.$or = [{ issueCategory: 'No_SPF_AND_DMARC' }, { $and: [{ 'issues.spf': { $regex: 'No SPF record found', $options: 'i' } }, { 'issues.dmarc': { $regex: 'No DMARC record found', $options: 'i' } }] }];
                    break;
                case 'No_DMARC_Only':
                    filter.$or = [{ issueCategory: 'No_DMARC_Only' }, { $and: [{ 'issues.dmarc': { $regex: 'No DMARC record found', $options: 'i' } }, { 'issues.spf': { $not: { $regex: 'No SPF record found', $options: 'i' } } }] }];
                    break;
                case 'No_SPF_Only':
                    filter.$or = [{ issueCategory: 'No_SPF_Only' }, { $and: [{ 'issues.spf': { $regex: 'No SPF record found', $options: 'i' } }, { 'issues.dmarc': { $not: { $regex: 'No DMARC record found', $options: 'i' } } }] }];
                    break;
                case 'DKIM_Issues':
                    filter.$or = [{ issueCategory: 'DKIM_Issues' }, { 'issues.dkim': { $regex: 'ERROR', $options: 'i' } }];
                    break;
                case 'Multiple_SPF':
                    filter.$or = [{ issueCategory: 'Multiple_SPF' }, { 'issues.spf': { $regex: 'Multiple', $options: 'i' } }];
                    break;
                case 'Multiple_DMARC':
                    filter.$or = [{ issueCategory: 'Multiple_DMARC' }, { 'issues.dmarc': { $regex: 'Multiple', $options: 'i' } }];
                    break;
                case 'DMARC_Policy_None':
                    filter.$or = [{ issueCategory: 'DMARC_Policy_None' }, { 'issues.dmarc': { $regex: 'Policy.*none', $options: 'i' } }];
                    break;
                default:
                    filter.issueCategory = issueFilter;
            }
        } else {
            filter.issueCategory = { $ne: 'Needs_Scan' };
        }

        const skip = (page - 1) * limit;

        // We need to group by domain so the admin sees distinct domains, not multiple identical rows 
        // if user A and user B track the same domain.
        const pipeline: any[] = [
            { $match: filter },
            {
                $group: {
                    _id: "$domain",
                    docId: { $first: "$_id" },
                    status: { $first: "$status" },
                    issuesDetected: { $max: "$issuesDetected" },
                    timestamp: { $first: "$timestamp" },
                    user: { $first: "$user" },
                    issueCategory: { $first: "$issueCategory" },
                    issues: { $first: "$issues" }
                }
            },
            { $sort: { _id: 1 } },
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [{ $skip: skip }, { $limit: limit }]
                }
            }
        ];

        const [aggregationResult] = await collection.aggregate(pipeline).toArray();
        const totalCount = aggregationResult?.metadata?.[0]?.total || 0;
        const domains = aggregationResult?.data || [];

        // Sanitize for Client Component
        const sanitizedDomains = domains.map((d: any) => ({
            _id: d.docId.toString(),
            domain: d._id || '',
            status: d.status || 'Warning',
            issuesDetected: d.issuesDetected || 0,
            timestamp: d.timestamp ? new Date(d.timestamp).toISOString() : null,
            user: typeof d.user === 'string' ? d.user : null,
            issueCategory: d.issueCategory || null,
            issues: d.issues || {}
        }));

        return {
            success: true,
            domains: sanitizedDomains,
            totalCount,
            totalPages: Math.ceil(totalCount / limit)
        };
    } catch (error) {
        console.error("Error fetching domains:", error);
        return { success: false, error: "Failed to fetch domains" };
    }
}
