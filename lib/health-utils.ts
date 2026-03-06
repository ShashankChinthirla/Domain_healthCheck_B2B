import { DnsResult } from './dns-utils';

export type HealthStatus = 'Good' | 'Warning' | 'Poor';

export interface HealthReport extends DnsResult {
    domain: string;
    healthStatus: HealthStatus;
}

export function evaluateHealth(dns: DnsResult): HealthStatus {
    let presentCount = 0;

    if (dns.spf) presentCount++;
    if (dns.dmarc) presentCount++;
    if (dns.mxRecords.length > 0) presentCount++;

    // Logic: 
    // All 3 present -> Good
    // 1 missing (2 present) -> Warning
    // 2 or more missing (0 or 1 present) -> Poor

    // Note: The prompt says: "If one missing -> Warning", "If two or more missing -> Poor"
    // If all 3 present (missing 0) -> Good

    const missingCount = 3 - presentCount;

    if (missingCount === 0) return 'Good';
    if (missingCount === 1) return 'Warning';
    return 'Poor';
}
