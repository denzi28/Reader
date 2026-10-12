const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * A content hash identifies a document wherever it lives, so the same PDF
 * opened twice (or later on another device) maps to the same notes.
 */
export async function fileId(buf: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle) {
    return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', buf)));
  }
  // Insecure contexts (plain http on a LAN address) have no SubtleCrypto.
  const bytes = new Uint8Array(buf);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < bytes.length; i++) {
    a = Math.imul(a ^ bytes[i], 0x01000193) >>> 0;
    b = Math.imul(b + bytes[i], 0x85ebca6b) >>> 0;
  }
  return `x${a.toString(16)}${b.toString(16)}${bytes.length.toString(16)}`;
}
