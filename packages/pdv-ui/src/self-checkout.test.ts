import { describe, expect, it } from 'vitest';
import { hashPin, newSelfCheckout, PIN_PATTERN } from './self-checkout';

describe('PIN do autoatendimento (F5-06)', () => {
  it('guarda só o hash com sal, nunca o PIN', async () => {
    const state = await newSelfCheckout('2468');
    expect(JSON.stringify(state)).not.toContain('2468');
    expect(state.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(await hashPin('2468', state.salt)).toBe(state.hash);
    expect(await hashPin('1111', state.salt)).not.toBe(state.hash);
    // O mesmo PIN em outro aparelho tem outro sal, logo outro hash.
    expect((await newSelfCheckout('2468')).hash).not.toBe(state.hash);
  });

  it('aceita de 4 a 6 números', () => {
    expect(PIN_PATTERN.test('1234')).toBe(true);
    expect(PIN_PATTERN.test('123456')).toBe(true);
    expect(PIN_PATTERN.test('123')).toBe(false);
    expect(PIN_PATTERN.test('12a4')).toBe(false);
  });
});
