import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { verifyAuth } from '@/lib/auth';
import { isAdmin } from '@/lib/roles';

const execAsync = promisify(exec);

export async function POST(request: Request) {
    try {
        // 1. Verify Identity and Admin Status Server-Side
        try {
            const auth = await verifyAuth(request);
            const userEmail = auth.email;

            // Strict Admin check for cancelling scans
            const adminStatus = await isAdmin(userEmail);
            if (!adminStatus) {
                console.warn(`Non-admin attempt to cancel scan: ${userEmail}`);
                return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
            }
        } catch (authError) {
            console.error('Auth verification failed for scan cancellation:', authError);
            return NextResponse.json({ error: 'Unauthorized: Invalid or missing token' }, { status: 401 });
        }
        if (process.env.NODE_ENV === 'development') {
            try {
                // Kill local scan process. Depending on OS:
                // Windows: powershell Stop-Process
                // macOS/Linux: pkill -f rescan_db_v3.ts
                const isWin = process.platform === "win32";
                const cmd = isWin
                    ? `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'rescan_db_v3' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`
                    : `pkill -f rescan_db_v3`;

                await execAsync(cmd);

                return NextResponse.json({
                    success: true,
                    message: 'Successfully killed local background scan process.'
                });
            } catch (err: any) {
                // If it fails, the process might not exist, which is fine.
                console.log("Local kill outcome:", err.message);
                return NextResponse.json({
                    success: true,
                    message: 'Scan stop signal sent locally. Assuming already stopped.'
                });
            }
        }

        const pat = process.env.GITHUB_PAT;
        if (!pat) {
            return NextResponse.json({ error: 'GITHUB_PAT missing.' }, { status: 401 });
        }

        const owner = 'ShashankChinthirla';
        const repo = 'Domain-Email-Health-Checker';
        const workflow_id = 'manual_scan.yml';

        const authHeaders = {
            'Accept': 'application/vnd.github.v3+json',
            'Authorization': `Bearer ${pat}`,
            'X-GitHub-Api-Version': '2022-11-28'
        };

        // Fetch in_progress runs
        const runsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow_id}/runs?status=in_progress`;
        const runsRes = await fetch(runsUrl, { headers: authHeaders });

        if (!runsRes.ok) {
            return NextResponse.json({ error: 'Failed to fetch active runs from GitHub.' }, { status: runsRes.status });
        }

        const data = await runsRes.json();
        const activeRuns = data.workflow_runs || [];

        // Check queued runs too
        const queuedUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow_id}/runs?status=queued`;
        const queuedRes = await fetch(queuedUrl, { headers: authHeaders });
        if (queuedRes.ok) {
            const queuedData = await queuedRes.json();
            activeRuns.push(...(queuedData.workflow_runs || []));
        }

        if (activeRuns.length === 0) {
            return NextResponse.json({ success: true, message: 'No active scans found to cancel.' });
        }

        let cancelCount = 0;
        for (const run of activeRuns) {
            const cancelUrl = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}/cancel`;
            const cancelRes = await fetch(cancelUrl, { method: 'POST', headers: authHeaders });
            if (cancelRes.ok || cancelRes.status === 202) {
                cancelCount++;
            }
        }

        return NextResponse.json({ success: true, message: `Successfully sent cancellation signals to ${cancelCount} running matrices.` });
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Unknown error occurred while attempting cancellation.' }, { status: 500 });
    }
}
