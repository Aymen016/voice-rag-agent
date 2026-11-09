/** @type {import('next').NextConfig} */
const backend = process.env.BACKEND_URL || 'http://localhost:4000';

const nextConfig = {
  reactStrictMode: true,
  // Proxy /api/* to the NestJS backend so the browser talks to one origin.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${backend}/api/:path*` }];
  },
  experimental: {
    // Agent turns on free-tier LLMs can take a while when rate limited.
    proxyTimeout: 120_000,
  },
};

export default nextConfig;
