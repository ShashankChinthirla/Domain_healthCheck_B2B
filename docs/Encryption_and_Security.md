# Advanced Security, Encryption & Decryption Documentation

This document explains the exact mechanisms the Domain Health Checker uses to secure sensitive data (such as API Keys or personal tokens) at rest using military-grade encryption formats. 

The core logic for this operation is entirely encapsulated inside the `lib/encryption.ts` file.

---

## 1. The Encryption Standard (AES-GCM 256-bit)

The backend utilizes the native Web Crypto API (`crypto.subtle`) available in modern Node.js and browser environments. It avoids the older, easily brute-forced `crypto` libraries in favor of **AES-GCM (Advanced Encryption Standard - Galois/Counter Mode) with 256-bit keys**.

**Why AES-GCM?**
* **Confidentiality:** It scrambles the text so it cannot be read without the key.
* **Integrity (Tamper-Proofing):** Unlike older methods (like AES-CBC), AES-GCM automatically appends an "Authentication Tag" to the encrypted data. If a hacker alters even a single byte of the encrypted database text, the decryption algorithm instantly notices the tampering and refuses to decrypt it.

---

## 2. The Master Key (`ENCRYPTION_KEY`)

The entire system relies on a central symmetric key stored in the `.env.local` environment file:
`ENCRYPTION_KEY="your-32-character-secret-password"`

* **Length Requirement:** The system explicitly checks that the `ENCRYPTION_KEY` is **exactly 32 bytes (256 bits)** long.
* **Runtime Verification:** If the key is missing or the wrong length when the server boots, the `getEncryptionKey()` helper function immediately throws a `FATAL` error, crashing the app to prevent insecure operations.

---

## 3. How Encryption Works (`encryptApiKey`)

When a user submits a sensitive string (e.g., an API token), this is the exact programmatic flow:

1. **Initialization Vector (IV):** The system generates a completely random, 16-byte cryptographic salt (the "IV") using `crypto.getRandomValues()`. This ensures that even if you encrypt the same exact password twice, the resulting encrypted texts will look completely different, preventing hackers from recognizing patterns.
2. **Text Encoding:** Converts the plain English text into a `Uint8Array` buffer.
3. **Execution:** The `crypto.subtle.encrypt` method combines the 32-byte Master Key, the 16-byte IV, and the plaintext data.
4. **Buffer Slicing:** Web Crypto AES-GCM natively attaches the Authentication Tag *at the very end* of the encrypted data. Our code surgically slices the final 16 bytes off to separate the `CipherText` from the `AuthTag`.
5. **Formatting:** It converts the raw buffers into human-readable Hexadecimal strings.
6. **Versioning:** It prepends `v1:` to the final string to allow for future algorithm upgrades without breaking old data.

**The Final Database String looks like this:**
```text
v1 : 4a5b6c... : 9f8e7d... : a1b2c3d4...
│    │           │           │
│    │           │           └── The actual encrypted data (CipherText)
│    │           └── Exposes the Tamper-Proof Signature (AuthTag Hex)
│    └── The Random Salt (IV Hex)
└── The Algorithm Version Identifier
```

---

## 4. How Decryption Works (`decryptApiKey`)

When the API needs to read a stored token from MongoDB, it pulls that long string out and reverses the process:

1. **String Parsing:** It splits the string by colons (`:`).
2. **Format Validation:** It checks if the string follows the new `v1` 4-part structure, or if it's a legacy 3-part structure from older databases. If the structure is corrupted, it throws an `Invalid format` error.
3. **Buffer Reconstruction:** It converts the Hex strings (IV, AuthTag, CipherText) back into raw Node.js Buffers.
4. **Buffer Concatenation:** Because Web Crypto's `decrypt` function strictly expects the Auth Tag to be attached to the back of the ciphertext, it executes: `Buffer.concat([cipherText, authTag])`.
5. **Execution:** It calls `crypto.subtle.decrypt` using the Master Key and the IV.
6. **Tamper Check:** If the Auth Tag doesn't match the CipherText (meaning someone manually edited the Hex string in the MongoDB database), the `decrypt` function immediately throws a **"Critical Decryption Failure"** exception, returning an empty string `""` to prevent any leaked data.
7. **Return:** If successful, it decodes the raw buffer back into a standard parsed JavaScript string.

---

## 5. Security Edge Cases Handled

* **Empty Strings:** The system natively catches errors inside a rigid `try/catch` block. If parsing completely crashes, it safely falls back to outputting `""` rather than crashing the Next.js API route.
* **Key Rotation Migration:** By structuring the output with `v1:`, if the developers ever switch to an algorithm like `chacha20-poly1305`, they can save strings as `v2:`. The `decryptApiKey` function can then read the prefix and automatically know *which* mathematical algorithm to run on *which* specific database row.
