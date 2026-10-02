import { expect, it } from 'vitest';
import { validateWooCommerceUrl } from '../src/services/woocommerceClient';

it('accepts a public HTTPS WooCommerce URL and removes a trailing path slash', () => {
  const url = validateWooCommerceUrl('https://store.example/shop/');
  expect(url.toString()).toBe('https://store.example/shop');
});

it.each(['http://store.example', 'https://127.0.0.1', 'https://localhost', 'https://store.example:8443', 'https://user:pass@store.example'])('rejects unsafe WooCommerce URL %s', value => {
  expect(() => validateWooCommerceUrl(value)).toThrow();
});
