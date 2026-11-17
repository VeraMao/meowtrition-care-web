// Personal connector keys. The full key is shown to the user once; only its SHA-256 is stored.

export function generateKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `mk_${b64}`
}

/** Hex SHA-256, identical to Postgres `encode(sha256(convert_to(key,'UTF8')),'hex')`. */
export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function connectorUrl(key: string, origin = window.location.origin): string {
  return `${origin}/api/mcp?key=${encodeURIComponent(key)}`
}
