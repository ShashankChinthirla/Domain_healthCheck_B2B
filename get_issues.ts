import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI || "mongodb+srv://admin:admin123@cluster0.k5ydz.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const client = new MongoClient(uri);

async function run() {
    try {
        await client.connect();
        const db = client.db('domain_guard'); // Or whatever the DB name is, checking how it connects in codebase
        const collection = db.collection('issue_domains');
        const docs = await collection.find({ "issuesDetected": { $gt: 0 } }).limit(5).toArray();
        console.log(JSON.stringify(docs.map(d => d.issues), null, 2));
    } finally {
        await client.close();
    }
}
run();
