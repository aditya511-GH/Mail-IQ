/**
 * AES-256-GCM Encryption/Decryption Utility
 * Uses the native Web Crypto API — no data ever leaves the browser.
 *
 * Key derivation: PBKDF2 from the user's Supabase UID + a fixed app salt.
 * This ensures keys are deterministic per-user and require no extra password.
 */

const PBKDF2_ITERATIONS = 310_000;
const SALT_STRING = 'medai-aes-salt-v1'; // static app-level salt

// ─── Helpers ─────────────────────────────────────────────────────────────────

function base64Encode(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64Decode(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

// ─── Key Derivation ──────────────────────────────────────────────────────────

/**
 * Derives a CryptoKey from a user UID via PBKDF2 → AES-256-GCM.
 * @param {string} uid  Supabase user id (used as passphrase)
 * @returns {Promise<CryptoKey>}
 */
export async function deriveKey(uid) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(uid),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: enc.encode(SALT_STRING),
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256',
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

// ─── Encrypt ─────────────────────────────────────────────────────────────────

/**
 * Encrypts a JSON-serialisable object with AES-256-GCM.
 * @param {object} data        Object to encrypt
 * @param {CryptoKey} key      Derived CryptoKey
 * @returns {Promise<{ ciphertext: string, iv: string }>}
 */
export async function encrypt(data, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
    const encoded = new TextEncoder().encode(JSON.stringify(data));

    const ciphertextBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoded
    );

    return {
        ciphertext: base64Encode(ciphertextBuffer),
        iv: base64Encode(iv),
    };
}

// ─── Decrypt ─────────────────────────────────────────────────────────────────

/**
 * Decrypts an AES-256-GCM encrypted payload back to a JS object.
 * @param {string} ciphertext  Base64 ciphertext
 * @param {string} iv          Base64 IV
 * @param {CryptoKey} key      Derived CryptoKey
 * @returns {Promise<object>}  Decrypted data
 */
export async function decrypt(ciphertext, iv, key) {
    const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64Decode(iv) },
        key,
        base64Decode(ciphertext)
    );

    const decoded = new TextDecoder().decode(decryptedBuffer);
    return JSON.parse(decoded);
}
