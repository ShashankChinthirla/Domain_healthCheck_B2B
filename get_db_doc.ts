import { MongoClient } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';

// Extract MONGODB_URI manually to avoid needing dotenv dependency
const envPath = path.resolve(__dirname, '.env.local');
let MONGODB_URI = 'mongodb://localhost:27017/vercel';
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/^MONGODB_URI=(.*)$/m);
    if (match) {
        MONGODB_URI = match[1].trim().replace(/['"]/g, '');
    }
}

const client = new MongoClient(MONGODB_URI);

async function run() {
    try {
        await client.connect();
        const db = client.db('vercel');
        const docs = await db.collection('issue_domains').find({ domain: { $regex: /3fcaptiveservicesdev/i } }).toArray();
        console.log(`Found ${docs.length} matches in real DB.`);
        if (docs.length > 0) {
            fs.writeFileSync('db_doc.json', JSON.stringify(docs, null, 2));
        }
    } finally {
        await client.close();
    }
}
run();
