// Helper to convert Base64 string to ArrayBuffer
const b64ToArrayBuffer = (b64: string): ArrayBuffer => {
    const str = atob(b64);
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
        bytes[i] = str.charCodeAt(i);
    }
    return bytes.buffer;
};

// Helper to convert ArrayBuffer to Base64 string
const arrayBufferToB64 = (buffer: ArrayBuffer): string => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
};


// --- PIN Hashing (PBKDF2) ---
export async function hashPinWithSalt(pin: string, salt?: ArrayBuffer): Promise<{ hash: string, salt: string }> {
    const saltBuffer = salt || crypto.getRandomValues(new Uint8Array(16));
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(pin),
        { name: "PBKDF2" },
        false,
        ["deriveBits"]
    );
    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: saltBuffer,
            iterations: 100000,
            hash: "SHA-256",
        },
        keyMaterial,
        256
    );

    return {
        hash: arrayBufferToB64(derivedBits),
        salt: arrayBufferToB64(saltBuffer),
    };
}

export async function verifyPin(pin: string, storedHash: string, storedSalt: string): Promise<boolean> {
    if (!pin || !storedHash || !storedSalt) return false;
    try {
        const saltBuffer = b64ToArrayBuffer(storedSalt);
        const { hash: hashOfInput } = await hashPinWithSalt(pin, saltBuffer);
        return hashOfInput === storedHash;
    } catch (e) {
        console.error("PIN verification failed", e);
        return false;
    }
}
