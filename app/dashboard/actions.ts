'use server';

import clientPromise from '@/lib/mongodb';
import { isAdmin } from '@/lib/roles';
import { verifyToken } from '@/lib/auth';

export async function getDashboardMetrics(token: string, integrationId?: string) {
    try {
        const auth = await verifyToken(token);
        const email = auth.email;
        if (!email) {
            return { success: false, error: "Unauthorized: Missing email in token" };
        }

        const client = await clientPromise;
        const db = client.db();

        const integrationsCount = await db.collection('integrations').countDocuments({ email });
        if (integrationsCount === 0) {
            return {
                totalDomains: 0,
                secureCount: 0,
                atRiskCount: 0,
                pendingCount: 0,
                addedToday: 0,
                success: true
            };
        }

        const collection = db.collection('issue_domains');

        const baseFilter: Record<string, unknown> = { ownerUserId: email };
        if (integrationId && integrationId !== 'All') {
            baseFilter.integrationId = integrationId;
        }

        // Calculate 'Added Today' dynamically
        const oneDayAgo = new Date();
        oneDayAgo.setDate(oneDayAgo.getDate() - 1);

        const [
            totalDomains,
            secureCount,
            pendingCount,
            addedToday,
            httpIssues,
            blacklistIssues,
            missingSpfAndDmarc,
            missingDmarcOnly,
            missingSpfOnly,
            dkimIssues,
            multipleSpf,
            multipleDmarc,
            dmarcPolicyNone
        ] = await Promise.all([
            collection.countDocuments(baseFilter),
            collection.countDocuments({ ...baseFilter, status: 'Secure' }),
            collection.countDocuments({ ...baseFilter, issueCategory: 'Needs_Scan' }),
            collection.countDocuments({ ...baseFilter, createdAt: { $gte: oneDayAgo } }),
            collection.countDocuments({ ...baseFilter, status: { $ne: 'Secure' }, $or: [{ issueCategory: 'http_issue' }, { 'issues.web': { $regex: 'ERROR', $options: 'i' } }] }),
            collection.countDocuments({ ...baseFilter, status: { $ne: 'Secure' }, $or: [{ issueCategory: 'blacklist_issue' }, { 'issues.blacklist': { $regex: 'ERROR|WARNING', $options: 'i' } }] }),
            collection.countDocuments({ ...baseFilter, status: { $ne: 'Secure' }, $or: [{ issueCategory: 'No_SPF_AND_DMARC' }, { $and: [{ 'issues.spf': { $regex: 'No SPF record found', $options: 'i' } }, { 'issues.dmarc': { $regex: 'No DMARC record found', $options: 'i' } }] }] }),
            collection.countDocuments({ ...baseFilter, status: { $ne: 'Secure' }, $or: [{ issueCategory: 'No_DMARC_Only' }, { $and: [{ 'issues.dmarc': { $regex: 'No DMARC record found', $options: 'i' } }, { 'issues.spf': { $not: { $regex: 'No SPF record found', $options: 'i' } } }] }] }),
            collection.countDocuments({ ...baseFilter, status: { $ne: 'Secure' }, $or: [{ issueCategory: 'No_SPF_Only' }, { $and: [{ 'issues.spf': { $regex: 'No SPF record found', $options: 'i' } }, { 'issues.dmarc': { $not: { $regex: 'No DMARC record found', $options: 'i' } } }] }] }),
            collection.countDocuments({ ...baseFilter, status: { $ne: 'Secure' }, $or: [{ issueCategory: 'DKIM_Issues' }, { 'issues.dkim': { $regex: 'ERROR', $options: 'i' } }] }),
            collection.countDocuments({ ...baseFilter, status: { $ne: 'Secure' }, $or: [{ issueCategory: 'Multiple_SPF' }, { 'issues.spf': { $regex: 'Multiple', $options: 'i' } }] }),
            collection.countDocuments({ ...baseFilter, status: { $ne: 'Secure' }, $or: [{ issueCategory: 'Multiple_DMARC' }, { 'issues.dmarc': { $regex: 'Multiple', $options: 'i' } }] }),
            collection.countDocuments({ ...baseFilter, status: { $ne: 'Secure' }, $or: [{ issueCategory: 'DMARC_Policy_None' }, { 'issues.dmarc': { $regex: 'Policy.*none', $options: 'i' } }] }),
        ]);

        const atRiskCount = totalDomains - secureCount;

        return {
            totalDomains,
            secureCount,
            atRiskCount,
            pendingCount,
            addedToday,
            issuesBreakdown: {
                httpIssues,
                blacklistIssues,
                missingSpfAndDmarc,
                missingDmarcOnly,
                missingSpfOnly,
                dkimIssues,
                multipleSpf,
                multipleDmarc,
                dmarcPolicyNone
            },
            success: true
        };
    } catch (error) {
        console.error("Error fetching metrics:", error);
        return { success: false, error: "Failed to fetch metrics" };
    }
}

export async function getPaginatedDomains(token: string, query = "", issueFilter = "", integrationId = "All", page = 1, limit = 50) {
    try {
        const auth = await verifyToken(token);
        const email = auth.email;
        if (!email) {
            return { success: false, error: "Unauthorized: Missing email in token" };
        }

        const client = await clientPromise;
        const db = client.db();

        const integrationsCount = await db.collection('integrations').countDocuments({ email });
        if (integrationsCount === 0) {
            return {
                success: true,
                domains: [],
                totalCount: 0,
                totalPages: 1
            };
        }

        const collection = db.collection('issue_domains');

        const filter: Record<string, unknown> = { ownerUserId: email };

        if (integrationId && integrationId !== 'All') {
            filter.integrationId = integrationId;
        }

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
                    filter.status = { $ne: 'Secure' };
                    filter.$or = [{ issueCategory: 'blacklist_issue' }, { 'issues.blacklist': { $regex: 'ERROR|WARNING', $options: 'i' } }];
                    break;
                case 'http_issue':
                    filter.status = { $ne: 'Secure' };
                    filter.$or = [{ issueCategory: 'http_issue' }, { 'issues.web': { $regex: 'ERROR', $options: 'i' } }];
                    break;
                case 'No_SPF_AND_DMARC':
                    filter.status = { $ne: 'Secure' };
                    filter.$or = [{ issueCategory: 'No_SPF_AND_DMARC' }, { $and: [{ 'issues.spf': { $regex: 'No SPF record found', $options: 'i' } }, { 'issues.dmarc': { $regex: 'No DMARC record found', $options: 'i' } }] }];
                    break;
                case 'No_DMARC_Only':
                    filter.status = { $ne: 'Secure' };
                    filter.$or = [{ issueCategory: 'No_DMARC_Only' }, { $and: [{ 'issues.dmarc': { $regex: 'No DMARC record found', $options: 'i' } }, { 'issues.spf': { $not: { $regex: 'No SPF record found', $options: 'i' } } }] }];
                    break;
                case 'No_SPF_Only':
                    filter.status = { $ne: 'Secure' };
                    filter.$or = [{ issueCategory: 'No_SPF_Only' }, { $and: [{ 'issues.spf': { $regex: 'No SPF record found', $options: 'i' } }, { 'issues.dmarc': { $not: { $regex: 'No DMARC record found', $options: 'i' } } }] }];
                    break;
                case 'DKIM_Issues':
                    filter.status = { $ne: 'Secure' };
                    filter.$or = [{ issueCategory: 'DKIM_Issues' }, { 'issues.dkim': { $regex: 'ERROR', $options: 'i' } }];
                    break;
                case 'Multiple_SPF':
                    filter.status = { $ne: 'Secure' };
                    filter.$or = [{ issueCategory: 'Multiple_SPF' }, { 'issues.spf': { $regex: 'Multiple', $options: 'i' } }];
                    break;
                case 'Multiple_DMARC':
                    filter.status = { $ne: 'Secure' };
                    filter.$or = [{ issueCategory: 'Multiple_DMARC' }, { 'issues.dmarc': { $regex: 'Multiple', $options: 'i' } }];
                    break;
                case 'DMARC_Policy_None':
                    filter.status = { $ne: 'Secure' };
                    filter.$or = [{ issueCategory: 'DMARC_Policy_None' }, { 'issues.dmarc': { $regex: 'Policy.*none', $options: 'i' } }];
                    break;
                default:
                    filter.issueCategory = issueFilter;
            }
        }

        const skip = (page - 1) * limit;

        const [domains, totalCount] = await Promise.all([
            collection.find(filter).sort({ domain: 1 }).skip(skip).limit(limit).toArray(),
            collection.countDocuments(filter)
        ]);

        // Sanitize for Client Component (Strict pick to avoid Next.js serialization crashes with BSON objects / Stripe data)
        const sanitizedDomains = domains.map(d => ({
            _id: d._id.toString(),
            domain: d.domain || '',
            status: d.status || 'Warning',
            issuesDetected: d.issuesDetected || 0,
            timestamp: d.timestamp ? d.timestamp.toISOString() : null,
            user: typeof d.ownerUserId === 'string' ? d.ownerUserId : (d.user?.email || null),
            issueCategory: d.issueCategory || null,
            issues: d.issues || {},
            assignedOwner: d.assignedOwner || null
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

export async function getFixableDomains(token: string) {
    try {
        const auth = await verifyToken(token);
        const email = auth.email;
        if (!email) {
            return { success: false, error: "Unauthorized: Missing email in token" };
        }

        const client = await clientPromise;
        const db = client.db();
        const collection = db.collection('issue_domains');

        // Note: The logic here directly maps to the user's strict requirement:
        // ONLY allow simple, singular DNS fixes.
        // DO NOT allow: HTTP issues, Blacklist issues, Multiple Records, or Missing Both.
        const filter = {
            ownerUserId: email,
            status: { $ne: 'Secure' },
            issueCategory: {
                $in: [
                    'No_SPF_Only',
                    'No_DMARC_Only',
                    'DMARC_Policy_None'
                ]
            }
        };

        const domains = await collection.find(filter).sort({ domain: 1 }).toArray();

        const sanitizedDomains = domains.map(d => ({
            _id: d._id.toString(),
            domain: d.domain || '',
            status: d.status || 'Warning',
            issuesDetected: d.issuesDetected || 0,
            timestamp: d.timestamp ? d.timestamp.toISOString() : null,
            user: typeof d.ownerUserId === 'string' ? d.ownerUserId : (d.user?.email || null),
            issueCategory: d.issueCategory || null,
            issues: d.issues || {},
            assignedOwner: d.assignedOwner || null
        }));

        return {
            success: true,
            domains: sanitizedDomains
        };
    } catch (error) {
        console.error("Error fetching fixable domains:", error);
        return { success: false, error: "Failed to fetch fixable domains" };
    }
}

export async function getPendingDomains(token: string) {
    try {
        const auth = await verifyToken(token);
        const email = auth.email;
        if (!email) {
            return { success: false, error: "Unauthorized: Missing email in token" };
        }

        const client = await clientPromise;
        const db = client.db();
        const collection = db.collection('issue_domains');

        const pending = await collection.find(
            { ownerUserId: email, issueCategory: 'Needs_Scan' },
            { projection: { _id: 1, domain: 1 } }
        ).toArray();

        return {
            success: true,
            domains: pending.map(d => ({
                id: d._id.toString(),
                domain: d.domain
            }))
        };
    } catch (error) {
        console.error("Error fetching pending domains:", error);
        return { success: false, error: "Failed to fetch pending domains" };
    }
}
