/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: [
    'better-sqlite3',
    'tree-sitter',
    'tree-sitter-javascript',
    'tree-sitter-typescript',
  ],
  devIndicators: false,
};

module.exports = nextConfig;
