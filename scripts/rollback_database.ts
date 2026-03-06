import { MongoClient } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';

// Extract MONGODB_URI manually to avoid needing dotenv dependency
const envPath = path.resolve(__dirname, '../.env.local');
let MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/vercel';
if (!process.env.MONGODB_URI && fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/^MONGODB_URI=(.*)$/m);
    if (match) {
        MONGODB_URI = match[1].trim().replace(/['"]/g, '');
    }
}

async function rollbackAll() {
    const logFiles = ['rescan_output2.txt', 'rescan_output_final.txt', 'rescan_output_repair.txt'];
    const rollbackMap = new Map<string, string>(); // domain -> oldCategory

    for (const file of logFiles) {
        const filePath = path.resolve(__dirname, '../', file);
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf16le');
            const lines = content.split('\n');
            for (const line of lines) {
                // Example line: [FIXED] test-automation-webhook.com : blacklist_issue -> No_SPF_AND_DMARC
                const match = line.match(/\[FIXED\]\s+([^\s:]+)\s+:\s+([^\s]+)\s+->/);
                if (match && match[1] && match[2]) {
                    const domain = match[1];
                    const oldCat = match[2];
                    // Since files are processed chronologically, this captures the very first state
                    if (!rollbackMap.has(domain)) {
                        rollbackMap.set(domain, oldCat);
                    }
                }
            }
        }
    }

    console.log(`Found ${rollbackMap.size} domains to completely roll back.`);
    if (rollbackMap.size === 0) return;

    console.log('Connecting to MongoDB...');
    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        const db = client.db('vercel');
        const collection = db.collection('issue_domains');

        let modifiedCount = 0;
        const domains = Array.from(rollbackMap.keys());

        // Execute rollback in chunks
        for (let i = 0; i < domains.length; i += 50) {
            const batch = domains.slice(i, i + 50);
            const promises = batch.map(domain => {
                const oldCat = rollbackMap.get(domain);
                const status = oldCat === 'Clean' ? 'Secure' : 'At Risk';
                return collection.updateOne(
                    { domain: domain },
                    { $set: { issueCategory: oldCat, status: status } }
                );
            });
            await Promise.all(promises);
            modifiedCount += batch.length;
            if (modifiedCount % 500 === 0) {
                console.log(`Rolled back ${modifiedCount} / ${rollbackMap.size} ...`);
            }
        }

        console.log(`✅ Successfully restored ${modifiedCount} domains to their original state.`);
    } catch (error) {
        console.error('Fatal Error:', error);
    } finally {
        await client.close();
        process.exit(0);
    }
}

rollbackAll();
