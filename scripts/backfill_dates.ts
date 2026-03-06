import clientPromise from '../lib/mongodb';

async function backfillDates() {
    console.log('Starting timestamp backfill...');
    try {
        const client = await clientPromise;
        const db = client.db('vercel');
        const collection = db.collection('issue_domains');

        // Fetch all documents that are missing createdAt or updatedAt
        const docs = await collection.find({
            $or: [
                { createdAt: { $exists: false } },
                { updatedAt: { $exists: false } }
            ]
        }).toArray();

        console.log(`Found ${docs.length} domains requiring timestamp backfills.`);

        if (docs.length === 0) {
            console.log('All domains already have correct timestamps. Exiting.');
            process.exit(0);
        }

        let updatedCount = 0;

        // We do this via bulkWrite for optimal performance across 12k records
        const bulkOps = docs.map(doc => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const updateFields: any = {};

            // If it lacks createdAt, we assume it's an old legacy domain. 
            // We set it to Unix epoch so it never accidentally triggers "Added Today"
            if (!doc.createdAt) {
                // If it has a timestamp field (from the python script), use that. Otherwise use a very old date.
                updateFields.createdAt = doc.timestamp ? new Date(doc.timestamp) : new Date(0);
            }

            // If it lacks updatedAt, default it to the same logic
            if (!doc.updatedAt) {
                updateFields.updatedAt = doc.timestamp ? new Date(doc.timestamp) : new Date(0);
            }

            return {
                updateOne: {
                    filter: { _id: doc._id },
                    update: { $set: updateFields }
                }
            };
        });

        if (bulkOps.length > 0) {
            console.log('Committing bulk backfill operation to MongoDB...');
            const result = await collection.bulkWrite(bulkOps);
            updatedCount = result.modifiedCount;
            console.log(`Successfully backfilled timestamps for ${updatedCount} domains!`);
        }

        process.exit(0);
    } catch (error) {
        console.error('Fatal Error during backfill:', error);
        process.exit(1);
    }
}

backfillDates();
