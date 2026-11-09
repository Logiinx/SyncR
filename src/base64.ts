// Bytes as base64 text and back. In chunks: one big String.fromCharCode(...bytes) overflows on
// big inputs (images). Its own file, so sealing.ts can use it without importing crypto.ts.

export function toBase64(bytes: Uint8Array) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function fromBase64(text: string) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
}
