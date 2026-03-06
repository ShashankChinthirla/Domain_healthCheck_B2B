
import clientPromise from '../lib/mongodb';

async function syncUsers() {
    console.log('Starting Cross-Collection User Synchronization...');
    try {
        const client = await clientPromise;
        const vercelDb = client.db('vercel');

        const issueCollection = vercelDb.collection('issue_domains');

        // Sometimes the production connection string lands on the wrong default DB
        // We will systematically search 'test', 'vercel', and 'Cluster0' for the setups collection.
        const dbNamesToTry = ['test', 'vercel', 'Cluster0', client.options?.dbName || 'test'];

        let dfyCollection = null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let allSetups: any[] = [];

        console.log('Searching for active mappings across databases...');
        for (const dbName of dbNamesToTry) {
            try {
                const targetDb = client.db(dbName);
                const col = targetDb.collection('dfyinfrasetups');
                const testDocs = await col.find({}).limit(5).toArray();

                if (testDocs.length > 0) {
                    console.log(`✅ Located populated dfyinfrasetups collection inside database: [${dbName}]`);
                    dfyCollection = col;
                    // Fetch them all now that we found the right DB
                    allSetups = await dfyCollection.find({}).toArray();
                    break;
                }
            } catch {
                // Ignore errors from missing DBs
            }
        }

        console.log(`Found ${allSetups.length} setup documents.`);

        if (allSetups.length === 0) {
            console.log('No dfyinfrasetups found. Exiting.');
            process.exit(0);
        }

        let updatedCount = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bulkOps: any[] = [];

        // Build a massive lookup map for O(1) matching. Store the whole document payload for rich syncing.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mappedDataByDomain = new Map<string, any>();

        for (const setup of allSetups) {
            if (!setup.domain) continue;
            const domain = setup.domain.toLowerCase().trim();

            let bestUser = null;

            // Priority 1: Direct user email field
            if (setup.user && typeof setup.user === 'string' && setup.user.includes('@')) {
                bestUser = setup.user;
            } else if (setup.contactDetails && Array.isArray(setup.contactDetails) && setup.contactDetails.length > 0) {
                // Priority 2: Fallback to first contactDetails email
                const firstContact = setup.contactDetails[0];
                if (firstContact && firstContact.email) {
                    bestUser = firstContact.email;
                }
            }

            // Store the rich payload mapped to the domain
            mappedDataByDomain.set(domain, {
                user: bestUser,
                contactDetails: setup.contactDetails || [],
                purchaseTxnId: setup.purchaseTxnId || null,
                startDate: setup.startDate || null,
                endDate: setup.endDate || null,
                forwardDomain: setup.forwardDomain || null
            });
        }

        console.log(`Successfully extracted ${mappedDataByDomain.size} distinct domain payloads. Propagating to issue_domains...`);

        // Now we fetch all issue_domains that MATCH these domains and need an update
        const domainsToUpdate = Array.from(mappedDataByDomain.keys());

        const existingIssueDomains = await issueCollection.find({
            domain: { $in: domainsToUpdate }
        }).toArray();

        for (const issueDoc of existingIssueDomains) {
            const domain = issueDoc.domain.toLowerCase();
            const richData = mappedDataByDomain.get(domain);

            if (richData) {
                // Guard against multi-tenant leaks. 
                // Only sync the setup details to the issue_domain if the ownerUserId matches the dfy setup user!
                if (issueDoc.ownerUserId && richData.user && issueDoc.ownerUserId !== richData.user) {
                    continue; // Skip this document, it belongs to someone else
                }

                // We always explicitly push the most up-to-date rich data from dfyinfrasetups.
                // It's a chron job, so overwriting ensures dates/contacts never drift out of sync.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const updatePayload: any = {
                    updatedAt: new Date()
                };

                if (richData.user) updatePayload.user = richData.user;
                if (richData.contactDetails.length > 0) updatePayload.contactDetails = richData.contactDetails;
                if (richData.purchaseTxnId) updatePayload.purchaseTxnId = richData.purchaseTxnId;
                if (richData.startDate) updatePayload.startDate = richData.startDate;
                if (richData.endDate) updatePayload.endDate = richData.endDate;
                if (richData.forwardDomain) updatePayload.forwardDomain = richData.forwardDomain;

                // Only append to bulk Ops if there's actual new stuff to write
                if (Object.keys(updatePayload).length > 1) { // >1 because updatedAt is always there
                    bulkOps.push({
                        updateOne: {
                            filter: { _id: issueDoc._id },
                            update: { $set: updatePayload }
                        }
                    });
                }
            }
        }

        if (bulkOps.length > 0) {
            console.log(`Committing ${bulkOps.length} user synchronization updates to MongoDB...`);
            const result = await issueCollection.bulkWrite(bulkOps);
            updatedCount = result.modifiedCount;
            console.log(`✅ Successfully synced ${updatedCount} user mappings!`);
        } else {
            console.log('✅ All users are already perfectly synced. No updates needed.');
        }

        process.exit(0);

    } catch (error) {
        console.error('Fatal Error during user sync:', error);
        process.exit(1);
    }
}

syncUsers();
