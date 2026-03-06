import { encryptApiKey } from '../lib/encryption';

try {
    const res = encryptApiKey('test');
    console.log("Success:", res);
} catch (e: any) {
    console.error("Encryption Failure:", e.message);
}
