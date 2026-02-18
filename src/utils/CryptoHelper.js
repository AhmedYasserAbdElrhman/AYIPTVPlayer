/**
 * CryptoHelper — AES-256-GCM encryption via Web Crypto API.
 *
 * Uses PBKDF2 key derivation with a random salt per encryption,
 * satisfying NIST SP 800-131A Rev 2 requirements for symmetric encryption.
 *
 * Storage format (base64-encoded): salt (16 B) + IV (12 B) + ciphertext
 */

const PASSPHRASE = 'AY-IPTV-Player-2024';
const SALT_LEN = 16;
const IV_LEN = 12;
const ITERATIONS = 100_000;

class CryptoHelper {
    /**
     * Encrypts a plaintext string.
     * @param {string} plaintext
     * @returns {Promise<string>} Base64-encoded salt+iv+ciphertext
     */
    static async encrypt(plaintext) {
        const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
        const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
        const key = await this._deriveKey(salt);
        const encoded = new TextEncoder().encode(plaintext);
        const cipherBuf = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            encoded,
        );

        const packed = new Uint8Array(SALT_LEN + IV_LEN + cipherBuf.byteLength);
        packed.set(salt, 0);
        packed.set(iv, SALT_LEN);
        packed.set(new Uint8Array(cipherBuf), SALT_LEN + IV_LEN);

        return btoa(String.fromCharCode(...packed));
    }

    /**
     * Decrypts a previously encrypted string.
     * @param {string} encoded Base64-encoded salt+iv+ciphertext
     * @returns {Promise<string>} Original plaintext
     */
    static async decrypt(encoded) {
        const packed = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
        const salt = packed.slice(0, SALT_LEN);
        const iv = packed.slice(SALT_LEN, SALT_LEN + IV_LEN);
        const cipherBuf = packed.slice(SALT_LEN + IV_LEN);
        const key = await this._deriveKey(salt);
        const plainBuf = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            cipherBuf,
        );
        console.log('plainBuf', new TextDecoder().decode(plainBuf));
        return new TextDecoder().decode(plainBuf);
    }

    /** @private */
    static async _deriveKey(salt) {
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(PASSPHRASE),
            'PBKDF2',
            false,
            ['deriveKey'],
        );

        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt'],
        );
    }
}

export default CryptoHelper;
