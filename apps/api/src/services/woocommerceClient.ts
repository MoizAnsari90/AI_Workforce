import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { z } from 'zod';

export const woocommerceCredentialSchema = z.object({
  storeUrl: z.string().url(),
  consumerKey: z.string().min(8),
  consumerSecret: z.string().min(8),
  storeName: z.string().optional(),
}).strict();

export function validateWooCommerceUrl(input: string) {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('Enter a valid WooCommerce store URL.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password || url.search || url.hash ||
      isIP(host) || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host.endsWith('.internal') || host.endsWith('.test')) {
    throw new Error('WooCommerce connection requires a public HTTPS store URL without login details or query parameters.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

function isPublicAddress(address: string): boolean {
  if (address.includes(':')) {
    const value = address.toLowerCase().split('%')[0];
    if (value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) return false;
    const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPublicAddress(mapped[1]) : true;
  }
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = octets;
  return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224);
}

export class WooCommerceClient {
  readonly storeUrl: URL;
  constructor(private readonly credentials: z.infer<typeof woocommerceCredentialSchema>) {
    this.storeUrl = validateWooCommerceUrl(credentials.storeUrl);
  }

  async request<T>(endpoint: string): Promise<T> {
    const addresses = await lookup(this.storeUrl.hostname, { all: true, verbatim: true }).catch(() => []);
    if (addresses.length === 0 || addresses.some(record => !isPublicAddress(record.address))) {
      throw new Error('WooCommerce store must resolve to public internet addresses.');
    }
    const base = this.storeUrl.toString().replace(/\/$/, '');
    const url = `${base}/wp-json/wc/v3/${endpoint.replace(/^\//, '')}`;
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: 'error', signal: AbortSignal.timeout(12000),
        headers: { Authorization: `Basic ${Buffer.from(`${this.credentials.consumerKey}:${this.credentials.consumerSecret}`).toString('base64')}`, Accept: 'application/json' },
      });
    } catch { throw new Error('WooCommerce store could not be reached safely. Check that its HTTPS API is publicly accessible.'); }
    if (!response.ok) throw new Error(`WooCommerce API rejected the connection (HTTP ${response.status}). Check REST API access and key permissions.`);
    return response.json() as Promise<T>;
  }

  async verify() {
    const products = await this.request<Array<{ id: number; name: string }>>('products?per_page=1');
    return { storeUrl: this.storeUrl.origin + this.storeUrl.pathname, sampleProduct: products[0]?.name ?? null };
  }
}
