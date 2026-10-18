import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Vercel packages server routes itself; containers retain standalone output.
  ...(process.env.VERCEL === '1' ? {} : { output: 'standalone' as const }),
  outputFileTracingRoot: path.join(__dirname, '../..'),
};
export default nextConfig;
