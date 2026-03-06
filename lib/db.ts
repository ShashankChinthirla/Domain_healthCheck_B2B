
import { db } from './firebase';
import { collection, addDoc, query, where, orderBy, limit, getDocs, doc, setDoc } from 'firebase/firestore';

export interface HistoryItem {
    id?: string;
    domain: string;
    score: number;
    timestamp: number;
    status: 'Pass' | 'Warning' | 'Fail';
}

// Save a new scan result
export async function saveScanResult(userId: string, domain: string, score: number) {
    if (!userId) return;

    const data = {
        userId,
        domain,
        score,
        timestamp: Date.now(),
        status: score >= 90 ? 'Pass' : score >= 70 ? 'Warning' : 'Fail'
    };

    // 1. Try Firebase (Best Effort)
    try {
        await addDoc(collection(db, 'scans'), data);
    } catch (error) {
        console.warn("Firebase write failed (likely permission/billing). Falling back to LocalStorage.", error);
    }

    // 2. ALWAYS Save to LocalStorage (Backup)
    try {
        const key = `history_${userId}`;
        const local = JSON.parse(localStorage.getItem(key) || '[]');
        local.unshift(data); // Add to top
        // Keep last 20 locally
        if (local.length > 20) local.pop();
        localStorage.setItem(key, JSON.stringify(local));
    } catch (e) {
        console.error("Local storage failed", e);
    }
}

// Get user History (Combined)
export async function getUserHistory(userId: string): Promise<HistoryItem[]> {
    if (!userId) return [];
    let firebaseDocs: HistoryItem[] = [];
    let localDocs: HistoryItem[] = [];

    // 1. Fetch Firebase
    try {
        const q = query(
            collection(db, 'scans'),
            where('userId', '==', userId),
            orderBy('timestamp', 'desc'),
            limit(10)
        );

        const snapshot = await getDocs(q);
        firebaseDocs = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })) as HistoryItem[];
    } catch (error) {
        console.warn("Firebase fetch failed. Serving local only.");
    }

    // 2. Fetch Local
    try {
        const key = `history_${userId}`;
        localDocs = JSON.parse(localStorage.getItem(key) || '[]');
    } catch (e) { }

    // 3. Merge & Deduplicate (Simple approach: Prefer Firebase if ID exists, else Local)
    // Actually, local items won't have 'id' (unless we mock it).
    // Let's just combine and sort.
    const combined = [...firebaseDocs, ...localDocs];

    // Dedupe by timestamp + domain roughly
    const seen = new Set();
    const unique = combined.filter(item => {
        const key = `${item.domain}-${Math.floor(item.timestamp / 1000)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    return unique.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
}

// Sync User Profile to Firestore (So it appears in Database tab)
export async function saveUserProfile(user: any) {
    if (!user) return;
    try {
        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName || '',
            lastLogin: Date.now()
        }, { merge: true });
    } catch (e: any) {
        console.warn("Could not sync user profile to DB", e);
    }
}
