import { adminAuth } from '@/lib/firebase-admin';

export async function verifyAuth(request: Request): Promise<{ email: string; uid: string }> {
    const authHeader = request.headers.get('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('Unauthorized: Missing or invalid Authorization header');
    }

    const token = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await adminAuth.verifyIdToken(token);
        if (!decodedToken.email) {
            throw new Error('Unauthorized: No email associated with token');
        }
        return { email: decodedToken.email, uid: decodedToken.uid };
    } catch (error) {
        throw error;
    }
}

/**
 * Verifies a Firebase ID Token string directly (useful for Server Actions).
 */
export async function verifyToken(token: string) {
    if (!token) throw new Error('No token provided');
    try {
        const decodedToken = await adminAuth.verifyIdToken(token);
        return decodedToken;
    } catch (error) {
        throw error;
    }
}
