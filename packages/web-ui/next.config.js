/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: [
    'better-sqlite3',
    'tree-sitter',
    'tree-sitter-c-sharp',
    'tree-sitter-cpp',
    'tree-sitter-javascript',
    'tree-sitter-python',
    'tree-sitter-typescript',
  ],
  devIndicators: false,
};

module.exports = nextConfig;
