/* eslint-disable @typescript-eslint/no-require-imports */
const { MongoClient } = require('mongodb');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

// Extract MONGODB_URI manually to avoid needing dotenv dependency
const envPath = path.resolve(__dirname, '.env.local');
let MONGODB_URI = 'mongodb://localhost:27017/vercel';
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/^MONGODB_URI=(.*)$/m);
    if (match) {
        MONGODB_URI = match[1].trim();
    }
}

async function seedDatabase() {
    console.log('Connecting to MongoDB...');
    const client = new MongoClient(MONGODB_URI);

    try {
        await client.connect();
        console.log('Connected to MongoDB.');
        const db = client.db();
        const collectionName = 'issue_domains';
        const collection = db.collection(collectionName);

        // Optional: Clear existing data for a fresh seed or just upsert. 
        // We will clear existing for a clean state, as requested "create an issue domains collection"
        // await collection.deleteMany({});
        // console.log(`Cleared existing documents from ${collectionName}.`);

        const filePath = path.resolve(__dirname, 'final_domain_issue_classification.xlsx');
        console.log(`Reading Excel file: ${filePath}`);
        const workbook = xlsx.readFile(filePath);

        let totalInserted = 0;

        for (const sheetName of workbook.SheetNames) {
            console.log(`\nProcessing sheet: ${sheetName}`);
            const sheet = workbook.Sheets[sheetName];
            const data = xlsx.utils.sheet_to_json(sheet);

            if (data.length === 0) continue;

            const docsToInsert = data.map((row) => ({
                domain: row['Domain'],
                user: row['User'] || null,
                score: row['Score'] !== undefined ? row['Score'] : null,
                healthStatus: row['Health Status'] || null,
                issueCategory: sheetName,
                status: sheetName === 'Clean' ? 'Secure' : 'At Risk', // Derived status for dashboard
                spfFull: row['SPF [Full]'] || null,
                updatedSpfFull: row['Updated SPF [Full]'] || null,
                dmarcFull: row['DMARC [Full]'] || null,
                updatedDmarcFull: row['Updated DMARC [Full]'] || null,
                issues: {
                    spf: row['SPF Issues'] || null,
                    dmarc: row['DMARC Issues'] || null,
                    dkim: row['DKIM Issues'] || null,
                    dns: row['DNS Issues'] || null,
                    web: row['Web Server Issues'] || null,
                    blacklist: row['Blacklist Issues'] || null,
                    smtp: row['SMTP Issues'] || null,
                },
                issuesDetected: calculateIssuesCount(row),
                timestamp: new Date()
            })).filter(doc => doc.domain); // ensure domain exists

            if (docsToInsert.length > 0) {
                // Use bulk write to upsert by domain to avoid duplicates if run multiple times
                const bulkOps = docsToInsert.map(doc => ({
                    updateOne: {
                        filter: { domain: doc.domain },
                        update: { $set: doc },
                        upsert: true
                    }
                }));

                const result = await collection.bulkWrite(bulkOps);
                console.log(`Processed ${data.length} rows. Upserted/Matched: ${result.upsertedCount + result.matchedCount}`);
                totalInserted += docsToInsert.length;
            }
        }

        console.log(`\n--- Seeding Complete! Processed ${totalInserted} domains. ---`);

    } catch (error) {
        console.error('Error seeding database:', error);
    } finally {
        await client.close();
        console.log('MongoDB connection closed.');
    }
}

function calculateIssuesCount(row) {
    let count = 0;
    const issueKeys = ['SPF Issues', 'DMARC Issues', 'DKIM Issues', 'DNS Issues', 'Web Server Issues', 'Blacklist Issues', 'SMTP Issues'];
    for (const key of issueKeys) {
        if (row[key] && typeof row[key] === 'string') {
            // Split by '|' as seen in the text output
            const issues = row[key].split('|').filter(i => i.trim() !== '');
            count += issues.length;
        }
    }
    return count;
}

seedDatabase();
