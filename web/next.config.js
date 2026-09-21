/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Produces a self-contained server bundle (only the deps actually used) so the
  // production Docker image doesn't need the full node_modules tree.
  output: "standalone",
};

module.exports = nextConfig;
