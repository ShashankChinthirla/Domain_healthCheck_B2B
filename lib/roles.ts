'use server';

import clientPromise from '@/lib/mongodb';

// Define the root admin that should always have access, regardless of database state
const ROOT_ADMIN = process.env.ROOT_ADMIN_EMAIL || 'shashankshashankc39@gmail.com'; // Fallback for dev only, should be set in env

export interface AdminUser {
    email: string;
    addedBy: string;
    createdAt: Date;
}

import { verifyToken } from '@/lib/auth';

/**
 * Checks if an email has admin privileges.
 * Automatically seeds the ROOT_ADMIN if the collection is empty.
 */
export async function isAdmin(email: string | null | undefined): Promise<boolean> {
    if (!email) return false;

    // Fast-path for root developer
    if (email === ROOT_ADMIN) return true;

    try {
        const client = await clientPromise;
        const db = client.db();
        const collection = db.collection<AdminUser>('admin_users');

        // Check if database is empty - if so, seed ROOT_ADMIN
        const count = await collection.countDocuments();
        if (count === 0) {
            await collection.insertOne({ email: ROOT_ADMIN, addedBy: 'system', createdAt: new Date() });
        }

        const adminDoc = await collection.findOne({ email });
        return !!adminDoc;
    } catch (error) {
        console.error("Error checking admin role:", error);
        return false;
    }
}

export async function getAdmins(token: string): Promise<AdminUser[]> {
    try {
        if (!token) {
            throw new Error("Unauthorized: Token required");
        }
        const decoded = await verifyToken(token);
        const isRequesterAdmin = await isAdmin(decoded.email);
        if (!isRequesterAdmin) throw new Error("Unauthorized: Admin access required");
        const client = await clientPromise;
        const db = client.db();
        const collection = db.collection<AdminUser>('admin_users');

        // Ensure root admin exists
        const count = await collection.countDocuments();
        if (count === 0) {
            await collection.insertOne({ email: ROOT_ADMIN, addedBy: 'system', createdAt: new Date() });
        }

        const result = await collection.find().sort({ createdAt: -1 }).toArray();
        return result.map(doc => ({
            email: doc.email,
            addedBy: doc.addedBy,
            createdAt: doc.createdAt
        })) as AdminUser[];
    } catch (error) {
        console.error("Error listing admins:", error);
        return [];
    }
}

export async function addAdmin(email: string, requesterToken: string): Promise<{ success: boolean; message: string }> {
    if (!email || !requesterToken) return { success: false, message: 'Email and token required' };

    try {
        const decoded = await verifyToken(requesterToken);
        const requesterEmail = decoded.email;

        // Authorize: Requester must be an admin
        const isRequesterAdmin = await isAdmin(requesterEmail);
        if (!isRequesterAdmin) {
            return { success: false, message: 'Unauthorized: Admin access required' };
        }

        const client = await clientPromise;
        const db = client.db();
        const collection = db.collection<AdminUser>('admin_users');

        // Check if already exists
        const exists = await collection.findOne({ email });
        if (exists) {
            return { success: false, message: 'User is already an admin' };
        }

        await collection.insertOne({
            email,
            addedBy: requesterEmail!,
            createdAt: new Date()
        });

        return { success: true, message: 'Admin added successfully' };
    } catch (error) {
        console.error("Error adding admin:", error);
        return { success: false, message: 'Authorization or database error' };
    }
}

export async function removeAdmin(emailToRemove: string, requesterToken: string): Promise<{ success: boolean; message: string }> {
    if (!emailToRemove || !requesterToken) return { success: false, message: 'Missing parameters' };

    try {
        const decoded = await verifyToken(requesterToken);
        const requesterEmail = decoded.email;

        // Authorize: Requester must be an admin
        const isRequesterAdmin = await isAdmin(requesterEmail);
        if (!isRequesterAdmin) {
            return { success: false, message: 'Unauthorized: Admin access required' };
        }

        // Prevent removing the root developer
        if (emailToRemove === ROOT_ADMIN) {
            return { success: false, message: 'Cannot remove the root administrator' };
        }

        // Prevent removing yourself (avoids accidental lockouts)
        if (emailToRemove === requesterEmail) {
            return { success: false, message: 'You cannot remove your own admin access' };
        }

        const client = await clientPromise;
        const db = client.db();
        const collection = db.collection<AdminUser>('admin_users');

        const result = await collection.deleteOne({ email: emailToRemove });

        if (result.deletedCount === 1) {
            return { success: true, message: 'Admin removed successfully' };
        } else {
            return { success: false, message: 'Admin not found' };
        }
    } catch (error) {
        console.error("Error removing admin:", error);
        return { success: false, message: 'Authorization or database error' };
    }
}
