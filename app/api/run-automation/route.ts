import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { verifyAuth } from '@/lib/auth';
import { isAdmin } from '@/lib/roles';

export async function POST(request: Request) {
    try {
        // 1. Verify Identity and Admin Status Server-Side
        let userEmail: string;
        try {
            const auth = await verifyAuth(request);
            userEmail = auth.email;

            // Strict Admin check for triggering scans
            const adminStatus = await isAdmin(userEmail);
            if (!adminStatus) {
                console.warn(`Non-admin attempt to trigger automation: ${userEmail}`);
                return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
            }
        } catch (authError) {
            console.error('Auth verification failed for automation trigger:', authError);
            return NextResponse.json({ error: 'Unauthorized: Invalid or missing token' }, { status: 401 });
        }

        console.log(`\n🚀 [MANUAL AUTOMATION] Triggered by ${userEmail}...`);
        console.log("------------------------------------------------------------------");

        // Spawn a background shell process to execute the two steps sequentially
        // Step 1: Inject DNS. Step 2: Deep Rescan. We pass the user's email so it's scoped.
        const command = `npx tsx scripts/update_cloudflare_dns.ts --user "${userEmail}" && npx tsx scripts/rescan_db_v3.ts --new --user "${userEmail}"`;

        const child = spawn(command, {
            shell: true,
            detached: true,
            stdio: 'inherit' // This pumps the live logs directly to the terminal stdout/stderr
        });

        child.unref();

        return NextResponse.json({
            success: true,
            message: 'Background automation successfully triggered! Watch the terminal logs.'
        });

    } catch (error) {
        console.error('Trigger error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
