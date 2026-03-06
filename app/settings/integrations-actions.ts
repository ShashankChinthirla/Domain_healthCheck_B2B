'use server';

import clientPromise from '@/lib/mongodb';
import { encryptApiKey } from '@/lib/encryption';

import { verifyToken } from '@/lib/auth';

export interface Integration {
    id: string;
    email: string; // The user who owns this integration
    provider: 'cloudflare';
    label: string;
    encryptedApiKey: string;
    createdAt: Date;
    updatedAt: Date;
}

// DTO for frontend so we never send the API key back, even encrypted
export interface IntegrationDTO {
    id: string;
    provider: 'cloudflare';
    label: string;
    createdAt: Date;
}

export async function addIntegration(token: string, provider: 'cloudflare', label: string, apiKey: string) {
    if (!token || !apiKey || !label) {
        return { success: false, error: "Missing required fields" };
    }

    try {
        const decodedToken = await verifyToken(token);
        const email = decodedToken.email;

        const client = await clientPromise;
        const db = client.db('vercel');
        const collection = db.collection<Integration>('integrations');

        const encryptedApiKey = await encryptApiKey(apiKey);

        const newIntegration: Integration = {
            id: crypto.randomUUID(),
            email: email!,
            provider,
            label,
            encryptedApiKey,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        await collection.insertOne(newIntegration);

        return { success: true };
    } catch (error: any) {
        console.error("Error adding integration:", error);
        return { success: false, error: "Failed to add integration securely: " + error.message };
    }
}

export async function getUserIntegrations(token: string): Promise<{ success: boolean; integrations?: IntegrationDTO[]; error?: string }> {
    if (!token) {
        return { success: false, error: "Token required" };
    }

    try {
        const decodedToken = await verifyToken(token);
        const email = decodedToken.email;

        const client = await clientPromise;
        const db = client.db('vercel');
        const collection = db.collection<Integration>('integrations');

        const integrations = await collection.find({ email }).sort({ createdAt: -1 }).toArray();

        // Strip sensitive data before sending to frontend
        const dtos: IntegrationDTO[] = integrations.map(int => ({
            id: int.id,
            provider: int.provider,
            label: int.label,
            createdAt: int.createdAt
        }));

        return { success: true, integrations: dtos };
    } catch (error) {
        console.error("Error fetching user integrations:", error);
        return { success: false, error: "Failed to fetch integrations" };
    }
}

export async function removeIntegration(token: string, integrationId: string) {
    if (!token || !integrationId) {
        return { success: false, error: "Missing required fields" };
    }

    try {
        const decodedToken = await verifyToken(token);
        const email = decodedToken.email;

        const client = await clientPromise;
        const db = client.db('vercel');
        const collection = db.collection<Integration>('integrations');

        // Only allow removing if they own it
        const result = await collection.deleteOne({ id: integrationId, email });

        if (result.deletedCount === 1) {
            // Cascading Delete: Remove all domains associated with this user and this integration
            const domainsCollection = db.collection('issue_domains');
            const deleteResult = await domainsCollection.deleteMany({
                ownerUserId: email,
                integrationId: integrationId
            });
            console.log(`Deleted ${deleteResult.deletedCount} domains associated with integration ${integrationId}`);

            return { success: true };
        } else {
            return { success: false, error: "Integration not found or unauthorized" };
        }
    } catch (error) {
        console.error("Error removing integration:", error);
        return { success: false, error: "Failed to remove integration" };
    }
}
