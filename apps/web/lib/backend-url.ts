// Resolve at request time so the same build works in local and container hosting.
export function backendUrl(path: string): string {
  const configured = process.env.API_INTERNAL_URL || process.env.API_URL || process.env.NEXT_PUBLIC_API_URL;
  if (!configured && process.env.NODE_ENV === 'production') {
    throw new Error('API_INTERNAL_URL must be configured for the web server');
  }
  const base = new URL(configured || 'http://localhost:3001');
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new Error('API_INTERNAL_URL must be an HTTP(S) origin');
  }
  return `${base.origin}${path}`;
}
