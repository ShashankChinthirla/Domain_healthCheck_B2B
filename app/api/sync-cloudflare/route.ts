import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { decryptApiKey } from '@/lib/encryption';
import { verifyAuth } from '@/lib/auth';
import { POST as triggerAutomation } from '@/app/api/run-automation/route';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        // 1. Verify Identity Server-Side
        let userEmail: string;
        try {
            console.log('Sync API: Verifying auth...');
            const auth = await verifyAuth(request);
            userEmail = auth.email;
        } catch (authError) {
            console.error('Auth check failed for Cloudflare sync:', authError);
            return NextResponse.json({ error: 'Unauthorized: Invalid or missing token' }, { status: 401 });
        }

        const email = userEmail;

        const client = await clientPromise;
        console.log('Sync API: MongoDB connected');
        const db = client.db('vercel');
        const domainsCollection = db.collection('issue_domains');
        const integrationsCollection = db.collection('integrations');

        const integrations = await integrationsCollection.find({
            email: email,
            provider: 'cloudflare'
        }).toArray();

        if (integrations.length === 0) {
            return NextResponse.json({ error: 'No Cloudflare integrations found.' }, { status: 404 });
        }

        let totalNewInserted = 0;
        let totalCloudflareDomainsCount = 0;
        const allNewDomainsAdded: string[] = [];

        // 1. Process all integrations sequentially to avoid rate limits and memory spikes
        console.log(`Sync API: Processing ${integrations.length} integrations...`);
        for (const integration of integrations) {
            console.log(`Sync API: Processing integration [${integration.label}]...`);
            const encryptedKey = integration.encryptedApiKey;
            const apiToken = await decryptApiKey(encryptedKey);

            if (!apiToken) {
                console.error(`Failed to decrypt API key for integration ${integration.label}`);
                return;
            }

            const allCloudflareDomains: string[] = [];

            // 1a. Fetch Page 1 to get Total Pages
            console.log(`Sync API: Fetching Cloudflare Page 1...`);
            const firstPageRes = await fetch(`https://api.cloudflare.com/client/v4/zones?per_page=500&page=1`, {
                headers: { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' }
            });
            console.log(`Sync API: Fetched Cloudflare Page 1. Res status: ${firstPageRes.status}`);
            const firstPageData = await firstPageRes.json();

            if (!firstPageRes.ok || !firstPageData.success) {
                console.error("Cloudflare API Error on Page 1:", firstPageData.errors);
                return;
            }

            allCloudflareDomains.push(...firstPageData.result.map((zone: { name: string }) => zone.name));
            const totalPages = firstPageData.result_info?.total_pages || 1;

            // 1b. Fetch remaining pages IN PARALLEL
            if (totalPages > 1) {
                const pagePromises = [];
                for (let p = 2; p <= totalPages; p++) {
                    pagePromises.push(
                        fetch(`https://api.cloudflare.com/client/v4/zones?per_page=500&page=${p}`, {
                            headers: { 'Authorization': `Bearer ${apiToken}`, 'Content-Type': 'application/json' }
                        }).then(r => r.json())
                    );
                }

                const pageResults = await Promise.all(pagePromises);
                for (const pg of pageResults) {
                    if (pg.success) {
                        allCloudflareDomains.push(...pg.result.map((zone: { name: string }) => zone.name));
                    }
                }
            }

            totalCloudflareDomainsCount += allCloudflareDomains.length;

            if (allCloudflareDomains.length === 0) continue;

            // 2. Fetch existing from MongoDB for THIS user, in chunks of 1000
            const existingDomainsSet = new Set<string>();
            const CHUNK_SIZE = 1000;
            for (let i = 0; i < allCloudflareDomains.length; i += CHUNK_SIZE) {
                const chunk = allCloudflareDomains.slice(i, i + CHUNK_SIZE);
                const existingDocs = await domainsCollection.find(
                    { domain: { $in: chunk }, ownerUserId: email },
                    { projection: { domain: 1 } }
                ).toArray();
                existingDocs.forEach(doc => existingDomainsSet.add(doc.domain));
            }

            // 3. Find Delta
            const newDomains = allCloudflareDomains.filter(domain => !existingDomainsSet.has(domain));
            console.log(`Sync API: Found ${newDomains.length} new domains to insert.`);

            // 4. Insert new domains
            if (newDomains.length > 0) {
                const docsToInsert = newDomains.map(domain => ({
                    domain: domain,
                    status: 'Pending',
                    issueCategory: 'Needs_Scan',
                    issuesDetected: 0,
                    spfFull: null,
                    dmarcFull: null,
                    user: email,
                    ownerUserId: email,
                    integrationId: integration.id,
                    healthStatus: 'Awaiting initial automation scan',
                    timestamp: new Date(),
                    createdAt: new Date()
                }));

                for (let i = 0; i < docsToInsert.length; i += CHUNK_SIZE) {
                    const chunk = docsToInsert.slice(i, i + CHUNK_SIZE);
                    await domainsCollection.insertMany(chunk, { ordered: false });
                }

                totalNewInserted += newDomains.length;
                allNewDomainsAdded.push(...newDomains);
            }
        }

        // 5. Auto-trigger the background scan engine for the unified experience
        console.log(`Sync API: Auto-triggering the background scan engine...`);
        try {
            // Forward the original authenticated request to securely trigger the Action
            await triggerAutomation(request);
        } catch (scanErr) {
            console.error("Non-fatal error auto-triggering automation:", scanErr);
        }

        console.log(`Sync API: Returning success. Total: ${totalCloudflareDomainsCount}, New: ${totalNewInserted}`);
        return NextResponse.json({
            success: true,
            message: 'Cloudflare sync complete',
            totalCloudflareDomains: totalCloudflareDomainsCount,
            newDomainsAdded: totalNewInserted,
            addedDomainsList: allNewDomainsAdded
        });

    } catch (error: unknown) {
        console.error('Error during Cloudflare sync:', error);
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error during sync' }, { status: 500 });
    }
}
