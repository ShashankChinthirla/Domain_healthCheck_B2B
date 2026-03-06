const ALGORITHM = 'AES-GCM';

// Helper to get encryption key securely at runtime
async function getEncryptionKey(): Promise<CryptoKey> {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
        throw new Error('FATAL: ENCRYPTION_KEY environment variable is missing.');
    }
    const keyBuffer = Buffer.from(key, 'utf-8');
    if (keyBuffer.length !== 32) {
        throw new Error(`FATAL: ENCRYPTION_KEY must be exactly 32 bytes. Current length is ${keyBuffer.length} bytes.`);
    }

    return await crypto.subtle.importKey(
        'raw',
        keyBuffer,
        { name: ALGORITHM, length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

export async function encryptApiKey(text: string): Promise<string> {
    const cryptoKey = await getEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const encodedText = new TextEncoder().encode(text);

    const encryptedBuffer = await crypto.subtle.encrypt(
        { name: ALGORITHM, iv },
        cryptoKey,
        encodedText
    );

    // In Web Crypto AES-GCM, the auth tag is appended to the ciphertext automatically.
    // We'll separate them here just to maintain absolute backward compatibility with our DB storage format.
    const encryptedArray = new Uint8Array(encryptedBuffer);
    const cipherText = encryptedArray.slice(0, encryptedArray.length - 16);
    const authTag = encryptedArray.slice(encryptedArray.length - 16);

    const ivHex = Buffer.from(iv).toString('hex');
    const authTagHex = Buffer.from(authTag).toString('hex');
    const encryptedHex = Buffer.from(cipherText).toString('hex');

    // 3. Key Versioning Strategy
    return `v1:${ivHex}:${authTagHex}:${encryptedHex}`;
}

export async function decryptApiKey(encryptedString: string): Promise<string> {
    try {
        const parts = encryptedString.split(':');

        let ivHex, authTagHex, encryptedTextHex;

        if (parts.length === 4 && parts[0] === 'v1') {
            ivHex = parts[1];
            authTagHex = parts[2];
            encryptedTextHex = parts[3];
        } else if (parts.length === 3) {
            ivHex = parts[0];
            authTagHex = parts[1];
            encryptedTextHex = parts[2];
        } else {
            throw new Error('Invalid encrypted text format (must be 3 or 4 colon-separated parts).');
        }

        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const cipherText = Buffer.from(encryptedTextHex, 'hex');

        // WebCrypto expects the auth tag appended to the ciphertext for AES-GCM decryption
        const combinedBuffer = Buffer.concat([cipherText, authTag]);

        const cryptoKey = await getEncryptionKey();

        const decryptedBuffer = await crypto.subtle.decrypt(
            { name: ALGORITHM, iv },
            cryptoKey,
            combinedBuffer
        );

        return new TextDecoder().decode(decryptedBuffer);
    } catch (error) {
        console.error("Critical Decryption Failure:", error);
        return "";
    }
}
