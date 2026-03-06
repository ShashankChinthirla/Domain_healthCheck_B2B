
import clientPromise from '../lib/mongodb';
import { decryptApiKey } from '../lib/encryption';

async function runSync() {
    console.log('Starting Cloudflare Sync...');
    try {
        const client = await clientPromise;
        const db = client.db('vercel');
        const domainsCollection = db.collection('issue_domains');
        const integrationsCollection = db.collection('integrations');

        const integrations = await integrationsCollection.find({ provider: 'cloudflare' }).toArray();

        if (integrations.length === 0) {
            console.log('No Cloudflare integrations found in DB.');
            process.exit(0);
        }

        let totalNewInserted = 0;

        for (const integration of integrations) {
            const userEmail = integration.email;
            const encryptedKey = integration.encryptedApiKey;
            const apiToken = decryptApiKey(encryptedKey);

            if (!apiToken) {
                console.error(`Failed to decrypt API key for user ${userEmail}`);
                continue;
            }

            console.log(`Syncing domains for user ${userEmail} via integration ${integration.label}...`);

            const allCloudflareDomains: string[] = [];
            let page = 1;
            let hasMore = true;

            // 1. Fetch ALL domains from Cloudflare for this integration
            while (hasMore) {
                console.log(`Fetching CF Page ${page} for ${userEmail}...`);
                const res = await fetch(`https://api.cloudflare.com/client/v4/zones?per_page=500&page=${page}`, {
                    headers: {
                        'Authorization': `Bearer ${apiToken}`,
                        'Content-Type': 'application/json'
                    }
                });

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const data: any = await res.json();

                if (!res.ok || !data.success) {
                    console.error(`Cloudflare API Error for ${userEmail}:`, data.errors);
                    break; // Move to next integration instead of exit
                }

                const domainsOnPage = data.result.map((zone: { name: string }) => zone.name);
                allCloudflareDomains.push(...domainsOnPage);

                const totalPages = data.result_info?.total_pages || 1;
                if (page >= totalPages) {
                    hasMore = false;
                } else {
                    page++;
                }
            }

            if (allCloudflareDomains.length === 0) {
                continue;
            }

            // 2. Fetch existing from MongoDB to prevent duplicates globally
            const existingDocs = await domainsCollection.find(
                { domain: { $in: allCloudflareDomains } },
                { projection: { domain: 1 } }
            ).toArray();

            const existingDomainsSet = new Set(existingDocs.map(doc => doc.domain));

            // 3. Find Delta
            const newDomains = allCloudflareDomains.filter(domain => !existingDomainsSet.has(domain));

            // 4. Insert into MongoDB
            if (newDomains.length > 0) {
                console.log(`Discovered ${newDomains.length} new domains! Inserting into DB...`);
                const docsToInsert = newDomains.map(domain => ({
                    domain: domain,
                    status: 'Pending',
                    issueCategory: 'Needs_Scan',
                    issuesDetected: 0,
                    spfFull: null,
                    dmarcFull: null,
                    user: userEmail,
                    ownerUserId: userEmail,
                    integrationId: integration.id,
                    healthStatus: 'Awaiting initial automation scan',
                    timestamp: new Date(),
                    createdAt: new Date()
                }));

                await domainsCollection.insertMany(docsToInsert);
                totalNewInserted += newDomains.length;
            } else {
                console.log(`No new domains found for ${userEmail} today.`);
            }
        }

        console.log(`Sync Complete. Total new domains inserted: ${totalNewInserted}`);
        process.exit(0);

    } catch (error) {
        console.error('Fatal Error during sync:', error);
        process.exit(1);
    }
}

runSync();
