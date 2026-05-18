/**
 * Regression tests for the MCP enum coercion helper.
 *
 * Protocol enums (`SubstrateType`, `ContextDomainType`, ...) ship
 * uppercase member names and lowercase string values. Downstream SQLite
 * filters compare against the lowercase value, so a caller that pipes
 * the member name through verbatim (`"RULE"`) used to silently match
 * zero rows. `coerceContextEnum` normalizes both shapes; these tests
 * lock in that behavior.
 */

import { describe, expect, it } from 'vitest';
import {
  ContextDomainType,
  ContextEventType,
  ContextNodeStatus,
  SubstrateType,
} from '@mindstrate/protocol';
import { coerceContextEnum } from '../src/tools/enum-coercion.js';

describe('coerceContextEnum', () => {
  it('returns the canonical lowercase value for an uppercase member name', () => {
    expect(coerceContextEnum(SubstrateType, 'RULE')).toBe(SubstrateType.RULE);
    expect(coerceContextEnum(ContextDomainType, 'ARCHITECTURE')).toBe(ContextDomainType.ARCHITECTURE);
    expect(coerceContextEnum(ContextNodeStatus, 'VERIFIED')).toBe(ContextNodeStatus.VERIFIED);
    expect(coerceContextEnum(ContextEventType, 'TEST_RESULT')).toBe(ContextEventType.TEST_RESULT);
  });

  it('passes through the canonical lowercase value unchanged', () => {
    expect(coerceContextEnum(SubstrateType, 'rule')).toBe(SubstrateType.RULE);
    expect(coerceContextEnum(ContextDomainType, 'architecture')).toBe(ContextDomainType.ARCHITECTURE);
  });

  it('returns undefined when no value was supplied so callers can spread the result', () => {
    expect(coerceContextEnum(SubstrateType, undefined)).toBeUndefined();
  });

  it('passes unknown values through verbatim so downstream validators can surface the real error', () => {
    // The Zod schema at the tool boundary already rejected nonsense
    // strings; coercion should not invent a fallback that masks that.
    expect(coerceContextEnum(SubstrateType, 'not-a-substrate' as never)).toBe('not-a-substrate');
  });
});
