import clientPromise from '../lib/mongodb';
import { decryptApiKey } from '../lib/encryption';

// Types exactly matching the Cloudflare JSON response
interface CloudflareDNSRecord {
    id: string;
    type: string;
    name: string;
    content: string;
    zone_id: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchCfApi(endpoint: string, apiToken: string, options: any = {}) {
    if (!apiToken) throw new Error('API Token is missing.');
    const res = await fetch(`https://api.cloudflare.com/client/v4${endpoint}`, {
        ...options,
        headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
        throw new Error(`Cloudflare API Error on ${endpoint}: ` + JSON.stringify(data.errors));
    }
    return data;
}

function generateUpdatedSpf(rawSpf: string | null): string {
    if (!rawSpf || rawSpf.toLowerCase() === 'missing') {
        return "v=spf1 a mx ~all";
    }
    // Replace hard fails or neutral with soft fail
    return rawSpf.replace(/-all|\?all/g, '~all');
}

function ensureMailto(val: string): string {
    return val.split(',')
        .map(p => p.trim())
        .filter(p => p)
        .map(p => p.toLowerCase().startsWith('mailto:') ? p : `mailto:${p}`)
        .join(', ');
}

function generateUpdatedDmarc(rawDmarc: string | null, domain: string): string {
    if (!rawDmarc || rawDmarc.toLowerCase() === 'missing') {
        rawDmarc = null;
    }

    let isAlreadyStrict = false;
    let syntaxError = false;

    if (rawDmarc) {
        isAlreadyStrict = rawDmarc.includes('p=reject') || (rawDmarc.includes('p=quarantine') && rawDmarc.includes('pct=100'));

        const mRua = rawDmarc.match(/rua=([^;]+)/i);
        if (mRua) {
            const parts = mRua[1].split(',').map(p => p.trim()).filter(p => p);
            if (parts.some(p => !p.toLowerCase().startsWith('mailto:'))) syntaxError = true;
        }

        const mRuf = rawDmarc.match(/ruf=([^;]+)/i);
        if (mRuf) {
            const parts = mRuf[1].split(',').map(p => p.trim()).filter(p => p);
            if (parts.some(p => !p.toLowerCase().startsWith('mailto:'))) syntaxError = true;
        }

        if (isAlreadyStrict && !rawDmarc.includes('p=none') && !syntaxError) {
            return rawDmarc;
        }
    }

    let rua = `mailto:dmarc-reports@${domain}`;
    let rufStr = "";

    if (rawDmarc) {
        const mRua = rawDmarc.match(/rua=([^;]+)/i);
        if (mRua) rua = ensureMailto(mRua[1]);

        const mRuf = rawDmarc.match(/ruf=([^;]+)/i);
        if (mRuf) rufStr = ` ruf=${ensureMailto(mRuf[1])};`;
    }

    return `v=DMARC1; p=reject; sp=reject; pct=100; rua=${rua};${rufStr} adkim=r; aspf=r;`;
}

async function updateCloudflareDns() {
    console.log('🚀 Starting Native Cloudflare DNS Auto-Updater...');
    try {
        const client = await clientPromise;
        const db = client.db('vercel');
        const collection = db.collection('issue_domains');
        const integrationsCollection = db.collection('integrations');

        // Target domains recently synced from Cloudflare waiting to be processed
        const userArgIndex = process.argv.indexOf('--user');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const query: any = { issueCategory: 'Needs_Scan' };
        if (userArgIndex !== -1 && process.argv.length > userArgIndex + 1) {
            query.ownerUserId = process.argv[userArgIndex + 1];
        }

        const pendingDocs = await collection.find(query).toArray();
        console.log(`Discovered ${pendingDocs.length} 'Needs_Scan' domains pending DNS Security injection.`);

        if (pendingDocs.length === 0) {
            console.log('✅ No new domains to update. Exiting gracefully.');
            process.exit(0);
        }

        for (const doc of pendingDocs) {
            const domain = doc.domain;
            console.log(`\n===========================================`);
            console.log(`🔄 Processing Domain: ${domain}`);

            if (!doc.integrationId) {
                console.log(`⚠️ Warning: No integrationId found for ${domain}. Skipping.`);
                continue;
            }

            const integration = await integrationsCollection.findOne({ id: doc.integrationId });
            if (!integration || !integration.encryptedApiKey) {
                console.log(`⚠️ Warning: Integration not found or missing API key for ${domain}. Skipping.`);
                continue;
            }

            const apiToken = await decryptApiKey(integration.encryptedApiKey);
            if (!apiToken) {
                console.log(`⚠️ Warning: Failed to decrypt API key for ${domain}. Skipping.`);
                continue;
            }

            try {
                // 1. Resolve Zone ID directly from CF
                const zoneData = await fetchCfApi(`/zones?name=${domain}`, apiToken);
                if (!zoneData.result || zoneData.result.length === 0) {
                    console.log(`⚠️ Warning: Zone ID for ${domain} could not be resolved in Cloudflare. Skipping.`);
                    continue;
                }
                const zoneId = zoneData.result[0].id;

                // 2. Fetch all TXT records for this zone
                const dnsData = await fetchCfApi(`/zones/${zoneId}/dns_records?type=TXT`, apiToken);
                const allTxtRecords: CloudflareDNSRecord[] = dnsData.result;

                const spfRecords = allTxtRecords.filter(r => r.content.includes('v=spf1') && r.name === domain);
                const dmarcRecords = allTxtRecords.filter(r =>
                    (r.content.startsWith('v=DMARC1') || r.content.includes('v=DMARC1;')) &&
                    (r.name === '_dmarc' || r.name === `_dmarc.${domain}`)
                );

                const rawSpf = spfRecords.length > 0 ? spfRecords[0].content : null;
                const rawDmarc = dmarcRecords.length > 0 ? dmarcRecords[0].content : null;

                const newSpf = generateUpdatedSpf(rawSpf);
                const newDmarc = generateUpdatedDmarc(rawDmarc, domain);

                let updatedSpf = false;
                let updatedDmarc = false;

                // 3. Update or Create SPF
                if (newSpf && newSpf !== rawSpf) {
                    console.log(`📤 Updating SPF: ${rawSpf || 'Missing'} -> ${newSpf}`);
                    if (spfRecords.length > 0) {
                        // Update existing
                        await fetchCfApi(`/zones/${zoneId}/dns_records/${spfRecords[0].id}`, apiToken, {
                            method: 'PUT',
                            body: JSON.stringify({ type: 'TXT', name: domain, content: newSpf, comment: "Auto-secured by DomainGuard V2" })
                        });
                    } else {
                        // Create new
                        await fetchCfApi(`/zones/${zoneId}/dns_records`, apiToken, {
                            method: 'POST',
                            body: JSON.stringify({ type: 'TXT', name: domain, content: newSpf, comment: "Auto-secured by DomainGuard V2" })
                        });
                    }
                    updatedSpf = true;
                } else {
                    console.log(`⚪ SPF is already perfectly optimized.`);
                }

                // 4. Update or Create DMARC
                if (newDmarc && newDmarc !== rawDmarc) {
                    console.log(`📤 Updating DMARC: ${rawDmarc || 'Missing'} -> ${newDmarc}`);
                    const dmarcName = `_dmarc.${domain}`;
                    if (dmarcRecords.length > 0) {
                        // Update existing
                        await fetchCfApi(`/zones/${zoneId}/dns_records/${dmarcRecords[0].id}`, apiToken, {
                            method: 'PUT',
                            body: JSON.stringify({ type: 'TXT', name: dmarcName, content: newDmarc, comment: "Auto-secured by DomainGuard V2" })
                        });
                    } else {
                        // Create new
                        await fetchCfApi(`/zones/${zoneId}/dns_records`, apiToken, {
                            method: 'POST',
                            body: JSON.stringify({ type: 'TXT', name: dmarcName, content: newDmarc, comment: "Auto-secured by DomainGuard V2" })
                        });
                    }
                    updatedDmarc = true;
                } else {
                    console.log(`⚪ DMARC is already perfectly optimized.`);
                }

                // 5. Explicitly Back Up & Log to Database
                if (updatedSpf || updatedDmarc) {
                    console.log(`💾 Committing original backups and metadata to MongoDB...`);

                    let newIssuesDetected = doc.issuesDetected > 0 ? doc.issuesDetected : 0;
                    if (updatedSpf && newIssuesDetected > 0) newIssuesDetected -= 1;
                    if (updatedDmarc && newIssuesDetected > 0) newIssuesDetected -= 1;

                    const newStatus = newIssuesDetected === 0 ? 'Secure' : doc.status;
                    const newIssueCategory = newIssuesDetected === 0 ? 'Clean' : doc.issueCategory;

                    await collection.updateOne({ _id: doc._id }, {
                        $set: {
                            originalSpfFull: rawSpf,
                            originalDmarcFull: rawDmarc,
                            automationDnsApplied: true,
                            updatedAt: new Date(),
                            status: newStatus,
                            issuesDetected: newIssuesDetected,
                            issueCategory: newIssueCategory
                        }
                    });
                }

                console.log(`✅ ${domain} completed.`);

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } catch (err: any) {
                console.error(`❌ Non-fatal Error processing ${domain}:`, err.message);
            }
        }

        console.log('\n🎉 Native Cloudflare DNS Auto-Updater Finished successfully.');
        process.exit(0);

    } catch (error) {
        console.error('Fatal Error during Native Cloudflare Update:', error);
        process.exit(1);
    }
}

updateCloudflareDns();
