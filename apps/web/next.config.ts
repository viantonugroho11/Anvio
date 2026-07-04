import type { NextConfig } from 'next';

const config: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.ANVIO_API_URL ?? 'http://localhost:3000'}/api/:path*`,
      },
    ];
  },
};

export default config;
