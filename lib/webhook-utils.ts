import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verifies an HMAC-SHA256 signature for a webhook payload.
 * Expected format: x-webhook-signature: sha256=HEX_SIGNATURE
 * Expected format: x-webhook-timestamp: UNIX_TIMESTAMP
 */
export async function verifyWebhookSignature(
    request: Request,
    secret: string
): Promise<boolean> {
    const signature = request.headers.get('x-webhook-signature');
    const timestamp = request.headers.get('x-webhook-timestamp');

    if (!signature || !timestamp) {
        console.error('Webhook verification failed: Missing signature or timestamp');
        return false;
    }

    // 1. Replay Protection: Check if the request is too old (e.g., > 5 minutes)
    const now = Math.floor(Date.now() / 1000);
    const requestTime = parseInt(timestamp, 10);
    if (Math.abs(now - requestTime) > 300) {
        console.error(`Webhook verification failed: Timestamp drift too large (${Math.abs(now - requestTime)}s)`);
        return false;
    }

    // 2. Body Read: Clone the request because we need to read the body buffer
    const bodyText = await request.clone().text();

    // 3. HMAC Generation: sha256(timestamp + "." + body)
    const hmac = createHmac('sha256', secret);
    hmac.update(`${timestamp}.${bodyText}`);
    const expectedSignature = `sha256=${hmac.digest('hex')}`;

    // 4. Timing Safe Comparison
    try {
        return timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
        );
    } catch (e) {
        return false;
    }
}
