/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "*": [
      ".meta-player/**/*",
      "dist/**/*",
      "release/**/*",
      "win-unpacked/**/*",
    ],
  },
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
