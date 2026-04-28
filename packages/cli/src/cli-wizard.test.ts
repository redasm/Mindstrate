import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatChoicePrompt,
  parseChoiceIndex,
} from './cli-wizard.js';

test('formatChoicePrompt renders numbered choices with a default', () => {
  const prompt = formatChoicePrompt('Setup mode', [
    { label: 'Local personal', value: 'local', description: 'Use this machine only' },
    { label: 'Team', value: 'team', description: 'Connect to Team Server' },
  ], 0);

  assert.equal(prompt, [
    'Setup mode',
    '  1. Local personal - Use this machine only',
    '  2. Team - Connect to Team Server',
    'Choose [1]: ',
  ].join('\n'));
});

test('parseChoiceIndex accepts empty input as the default choice', () => {
  assert.equal(parseChoiceIndex('', 3, 1), 1);
});

test('parseChoiceIndex accepts one-based numeric choices', () => {
  assert.equal(parseChoiceIndex('2', 3, 0), 1);
});

test('parseChoiceIndex rejects out-of-range input', () => {
  assert.equal(parseChoiceIndex('4', 3, 0), null);
});
