import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
let client: MongoClient | null = null;
let clientPromise: Promise<MongoClient>;

if (!uri) {
    // In some environments (like Vercel build) MONGODB_URI might be missing.
    // We create a promise that rejects only when awaited, to avoid breaking the build.
    clientPromise = Promise.reject(new Error('FATAL: MONGODB_URI environment variable is missing.'));
} else {
    client = new MongoClient(uri);

    if (process.env.NODE_ENV === 'development') {
        const globalWithMongo = global as typeof globalThis & {
            _mongoClientPromise?: Promise<MongoClient>;
        };

        if (!globalWithMongo._mongoClientPromise) {
            globalWithMongo._mongoClientPromise = client.connect();
        }
        clientPromise = globalWithMongo._mongoClientPromise;
    } else {
        clientPromise = client.connect();
    }
}

// Export a module-scoped MongoClient promise. By doing this in a
// separate module, the client can be shared across functions.
export default clientPromise;
