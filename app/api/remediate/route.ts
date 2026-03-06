import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { decryptApiKey } from '@/lib/encryption';
import { ObjectId } from 'mongodb';
import { verifyAuth } from '@/lib/auth';


// Types exactly matching the Cloudflare JSON response
interface CloudflareDNSRecord {
    id: string;
    type: string;
    name: string;
    content: string;
    zone_id: string;
}

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

function generateUpdatedSpf(rawSpf: string | null): string | null {
    if (!rawSpf || rawSpf.toLowerCase() === 'missing') {
        // Provide a highly compatible baseline SPF policy if the domain has none.
        return 'v=spf1 include:_spf.google.com ~all';
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

function generateUpdatedDmarc(rawDmarc: string | null, domain: string): string | null {
    if (!rawDmarc || rawDmarc.toLowerCase() === 'missing') {
        // Generate a strict baseline DMARC record if completely missing
        return `v=DMARC1; p=reject; sp=reject; pct=100; rua=mailto:dmarc-reports@${domain}; adkim=r; aspf=r;`;
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

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        // 1. Verify Identity Server-Side
        let userEmail: string;
        try {
            const auth = await verifyAuth(request);
            userEmail = auth.email;
        } catch (authError) {
            console.error('Auth check failed for remediate API:', authError);
            return NextResponse.json({ error: 'Unauthorized: Invalid or missing token' }, { status: 401 });
        }

        const payload = await request.json().catch(() => ({}));
        const { domainId } = payload;

        if (!domainId || !ObjectId.isValid(domainId)) {
            return NextResponse.json({ error: 'Missing or invalid domain ID' }, { status: 400 });
        }

        const client = await clientPromise;
        const db = client.db('vercel');
        const domainsCollection = db.collection('issue_domains');
        const integrationsCollection = db.collection('integrations');

        // Verify ownership using secure email from token
        const doc = await domainsCollection.findOne({ _id: new ObjectId(domainId), ownerUserId: userEmail });

        if (!doc) {
            return NextResponse.json({ error: 'Domain not found or unauthorized.' }, { status: 404 });
        }

        if (!doc.integrationId) {
            return NextResponse.json({ error: 'No integration linked to this domain.' }, { status: 400 });
        }

        // Fetch the integration to get the API key using the correct UUID reference
        const integration = await integrationsCollection.findOne({
            id: doc.integrationId,
            email: userEmail
        });

        if (!integration) {
            return NextResponse.json({ error: 'Integration not found or unauthorized.' }, { status: 404 });
        }

        const apiToken = await decryptApiKey(integration.encryptedApiKey);
        if (!apiToken) {
            return NextResponse.json({ error: 'Failed to decrypt integration API key.' }, { status: 500 });
        }

        const domain = doc.domain;
        console.log(`\n===========================================`);
        console.log(`🔄 Processing Remediation for: ${domain}`);

        // 1. Resolve Zone ID directly from CF using the extracted Token
        const zoneData = await fetchCfApi(`/zones?name=${domain}`, apiToken);
        if (!zoneData.result || zoneData.result.length === 0) {
            return NextResponse.json({ error: `Zone ID for ${domain} could not be resolved in Cloudflare.` }, { status: 400 });
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

        if (spfRecords.length > 1 || dmarcRecords.length > 1) {
            return NextResponse.json({ error: `Cannot safely auto-remediate ${domain} because it has multiple conflicting SPF or DMARC records.` }, { status: 400 });
        }

        const rawSpf = spfRecords.length > 0 ? spfRecords[0].content : null;
        const rawDmarc = dmarcRecords.length > 0 ? dmarcRecords[0].content : null;

        const newSpf = generateUpdatedSpf(rawSpf);
        const newDmarc = generateUpdatedDmarc(rawDmarc, domain);

        let updatedSpf = false;
        let updatedDmarc = false;

        // 3. Update or Create SPF
        if (newSpf && newSpf !== rawSpf) {
            console.log(`📤 Updating SPF: ${rawSpf || 'Missing'} -> ${newSpf}`);
            if (rawSpf && spfRecords.length > 0) {
                // If an existing actual SPF record was found, overwrite it
                await fetchCfApi(`/zones/${zoneId}/dns_records/${spfRecords[0].id}`, apiToken, {
                    method: 'PUT',
                    body: JSON.stringify({ type: 'TXT', name: domain, content: newSpf, comment: "Auto-secured by DomainGuard V2" })
                });
            } else {
                // Otherwise, append a brand new record (preserves existing TXT like google-site-verification)
                await fetchCfApi(`/zones/${zoneId}/dns_records`, apiToken, {
                    method: 'POST',
                    body: JSON.stringify({ type: 'TXT', name: domain, content: newSpf, comment: "Auto-secured by DomainGuard V2" })
                });
            }
            updatedSpf = true;
        }

        // 4. Update or Create DMARC
        if (newDmarc && newDmarc !== rawDmarc) {
            console.log(`📤 Updating DMARC: ${rawDmarc || 'Missing'} -> ${newDmarc}`);
            const dmarcName = `_dmarc.${domain}`;
            if (rawDmarc && dmarcRecords.length > 0) {
                // If an existing actual DMARC record was found, overwrite it
                await fetchCfApi(`/zones/${zoneId}/dns_records/${dmarcRecords[0].id}`, apiToken, {
                    method: 'PUT',
                    body: JSON.stringify({ type: 'TXT', name: dmarcName, content: newDmarc, comment: "Auto-secured by DomainGuard V2" })
                });
            } else {
                // Otherwise, append a brand new record
                await fetchCfApi(`/zones/${zoneId}/dns_records`, apiToken, {
                    method: 'POST',
                    body: JSON.stringify({ type: 'TXT', name: dmarcName, content: newDmarc, comment: "Auto-secured by DomainGuard V2" })
                });
            }
            updatedDmarc = true;
        }

        // 5. Explicitly Back Up & Log to Database AND trigger a status change
        if (updatedSpf || updatedDmarc) {
            console.log(`💾 Committing original backups and metadata to MongoDB...`);

            // Recalculate issues detected based on what was fixed
            let newIssuesDetected = doc.issuesDetected > 0 ? doc.issuesDetected : 0;
            if (updatedSpf && newIssuesDetected > 0) newIssuesDetected -= 1;
            if (updatedDmarc && newIssuesDetected > 0) newIssuesDetected -= 1;

            // Immediately mark it as needing a fresh scan so the Python Matrix can cleanly assign
            // any remaining HTTP/Blacklist issues without keeping stale 'No_SPF' flags.
            const newIssuesObj = { ...(doc.issues || {}) };
            if (updatedSpf) delete newIssuesObj.spf;
            if (updatedDmarc) delete newIssuesObj.dmarc;

            const backupState = {
                timestamp: new Date().toISOString(),
                issuesDetected: doc.issuesDetected,
                status: doc.status,
                issueCategory: doc.issueCategory,
                issues: doc.issues,
                rawSpf,
                rawDmarc
            };

            await domainsCollection.updateOne({ _id: doc._id }, {
                $set: {
                    originalSpfFull: rawSpf,
                    originalDmarcFull: rawDmarc,
                    automationDnsApplied: true,
                    updatedAt: new Date(),
                    status: 'At Risk', // Temporarily keep At Risk until the scanner proves it's Secure
                    issueCategory: 'Needs_Scan', // Force the matrix to pick it up immediately
                    issuesDetected: newIssuesDetected,
                    issues: newIssuesObj
                },
                $push: {
                    backups: backupState
                }
            } as any);

            return NextResponse.json({
                success: true,
                message: `Successfully remediated DNS issues for ${domain}`,
                updatedSpf,
                updatedDmarc
            });
        }

        return NextResponse.json({
            success: true,
            message: `No changes needed for ${domain}. It is already secure.`
        });

    } catch (error: any) {
        console.error('Error during remediation:', error);
        return NextResponse.json({ error: error.message || 'Internal server error during remediation' }, { status: 500 });
    }
}
