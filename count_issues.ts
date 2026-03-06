import * as fs from 'fs';

function calculateIssuesCount(report: any): any[] {
    const countedTests: any[] = [];
    if (!report.categories) return countedTests;

    const ignoredInfos = [
        'Timed Out', 'Timeout', 'DNS Error', 'DNS Lookup Failed',
        'Failed', 'Unreachable', 'Rate Limited', 'TIMEOUT'
    ];

    for (const catKey of Object.keys(report.categories)) {
        const tests = report.categories[catKey].tests || [];
        for (const t of tests) {
            if (t.status === 'Error' || t.status === 'Warning') {
                if (!ignoredInfos.some(noise => t.info?.includes(noise))) {
                    countedTests.push({ category: catKey, name: t.name, info: t.info });
                }
            }
        }
    }
    return countedTests;
}

const data = JSON.parse(fs.readFileSync('out.json', 'utf8'));
const issues = calculateIssuesCount(data);
console.log(`Found ${issues.length} issues:`);
console.log(JSON.stringify(issues, null, 2));
