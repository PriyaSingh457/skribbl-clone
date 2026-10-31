import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGuess, maskWord, ALL_WORDS } from '../src/words.js';
import { calculateGuessPoints } from '../src/scoring.js';

test('guess normalization trims spaces, handles case and trailing punctuation', () => {
  assert.equal(normalizeGuess('  PiZzA!! '), 'pizza');
  assert.equal(normalizeGuess('ice   cream'), 'ice cream');
});

test('guess matching remains exact rather than accepting partial words', () => {
  assert.notEqual(normalizeGuess('cat'), normalizeGuess('caterpillar'));
});

test('word masking reveals requested number of letters and keeps spaces', () => {
  assert.equal(maskWord('pizza', 0), '_ _ _ _ _');
  assert.equal(maskWord('pizza', 2), 'p i _ _ _');
  assert.equal(maskWord('ice cream', 1), 'i _ _   _ _ _ _ _');
});

test('guess points reward fast guesses and retain a minimum', () => {
  assert.equal(calculateGuessPoints({ drawTimeSeconds: 80, elapsedSeconds: 0 }), 100);
  assert.equal(calculateGuessPoints({ drawTimeSeconds: 80, elapsedSeconds: 40 }), 50);
  assert.equal(calculateGuessPoints({ drawTimeSeconds: 80, elapsedSeconds: 79 }), 25);
  assert.equal(calculateGuessPoints({ drawTimeSeconds: 80, elapsedSeconds: 95 }), 25);
});

test('word bank contains enough unique words for all configured choices', () => {
  assert.ok(ALL_WORDS.length >= 50);
  assert.equal(new Set(ALL_WORDS).size, ALL_WORDS.length);
});
