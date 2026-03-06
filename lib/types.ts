export type TestStatus = 'Pass' | 'Warning' | 'Error';

export interface TestResult {
    name: string;
    status: TestStatus;
    info: string;
    reason: string;         // Explanation of why this status resulted
    recommendation: string; // Actionable fix advice
    category?: string;      // Optional category reference
    host?: string;          // The specific host being tested (e.g. domain, mx, or blacklist zone)
    result?: string;        // Short human-readable summary of the outcome (MxToolbox style)
    type?: 'IP' | 'DOMAIN'; // Added for categorizing tests
    severity?: 'HIGH' | 'MEDIUM' | 'LOW'; // Added for impact analysis
}

export interface CategoryResult {
    category: string;
    tests: TestResult[];
    stats: {
        passed: number;
        warnings: number;
        errors: number;
    };
}

export interface FullHealthReport {
    domain: string;
    score: number;
    rawSpf: string | null;
    rawDmarc: string | null;
    dmarcPolicy: string | null;
    mxRecords: string[];
    categories: {
        problems: CategoryResult;
        dns: CategoryResult;
        spf: CategoryResult;
        dmarc: CategoryResult;
        dkim: CategoryResult;
        blacklist: CategoryResult;
        smtp: CategoryResult;
        webServer: CategoryResult;
    };
    dbEmail?: string | null;
}
