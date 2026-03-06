import { promises as dns } from 'dns';

export interface DnsResult {
    spf: string | null;
    dmarc: string | null;
    dmarcPolicy: string | null;
    mxRecords: string[];
    error?: string;
}

export async function checkDomainDNS(domain: string): Promise<DnsResult> {
    const result: DnsResult = {
        spf: null,
        dmarc: null,
        dmarcPolicy: null,
        mxRecords: [],
    };

    try {
        // SPF Lookup
        const txtRecords = await dns.resolveTxt(domain).catch(() => []);
        // TXT records are arrays of strings (chunks), join them
        const spfRec = txtRecords
            .map((chunks) => chunks.join(''))
            .find((txt) => txt.toLowerCase().startsWith('v=spf1'));

        result.spf = spfRec || null;
    } catch (e) {
        if (e instanceof Error) {
            // Log or handle specific SPF errors if needed
        }
    }

    try {
        // DMARC Lookup
        const dmarcRecords = await dns.resolveTxt(`_dmarc.${domain}`).catch(() => []);
        const dmarcRec = dmarcRecords
            .map((chunks) => chunks.join(''))
            .find((txt) => txt.toLowerCase().startsWith('v=dmarc1'));

        result.dmarc = dmarcRec || null;

        if (dmarcRec) {
            const match = dmarcRec.match(/p=(\w+)/i);
            if (match) {
                result.dmarcPolicy = match[1].toLowerCase();
            }
        }
    } catch (e) {
        // DMARC lookup fail
    }

    try {
        // MX Lookup
        const mx = await dns.resolveMx(domain).catch(() => []);
        result.mxRecords = mx.map((m) => m.exchange);
    } catch (e) {
        // MX lookup fail
    }

    return result;
}
