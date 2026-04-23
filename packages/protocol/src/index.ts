/**
 * @mindstrate/protocol
 *
 * Type-only protocol shared between Mindstrate clients and servers.
 * - Zero runtime dependencies (no native modules, no SQLite, no openai).
 * - Safe to import from anywhere, including team-only client distributions.
 * - The single source of truth for the over-the-wire data shape.
 */

// Models (knowledge + session + feedback + retrieval)
export * from './models/index.js';

// Errors
export * from './errors.js';

// Server-side result types that cross the wire
export * from './results.js';
