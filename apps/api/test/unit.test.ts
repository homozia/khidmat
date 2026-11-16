import { describe, expect, it } from 'vitest';
import { commissionFee, formatPkr, lineAmount, rupees } from '../src/lib/money.ts';
import { maskPhone, normalizePkMobile } from '../src/lib/phone.ts';
import { allowedTargets, canTransition } from '../src/domain/states.ts';
import { detId } from '../src/lib/ids.ts';

describe('commission maths (8% = 800 bps, round half up, integer paisa)', () => {
  it('worked example A: labour 800 -> fee 64', () => {
    expect(commissionFee(rupees(800), 800)).toBe(rupees(64));
  });
  it('worked example B: 2,500 commissionable -> 200; after 300 refund 2,200 -> 176', () => {
    expect(commissionFee(rupees(2500), 800)).toBe(rupees(200));
    expect(commissionFee(rupees(2200), 800)).toBe(rupees(176));
  });
  it('worked example C: driver 3,000 commissionable -> 240', () => {
    expect(commissionFee(rupees(3000), 800)).toBe(rupees(240));
  });
  it('rounds half up to the paisa', () => {
    expect(commissionFee(1234_56, 800)).toBe(98_76); // 9876.48 -> 9876
    expect(commissionFee(6_25, 800)).toBe(50);       // 50.0
    expect(commissionFee(6_31, 800)).toBe(50);       // 50.48 -> 50
    expect(commissionFee(6_32, 800)).toBe(51);       // 50.56 -> 51
    expect(commissionFee(1_00, 50)).toBe(1);         // 0.5 -> 1 (half up)
  });
  it('rejects fractional or negative amounts and bad rates', () => {
    expect(() => commissionFee(10.5, 800)).toThrow();
    expect(() => commissionFee(-1, 800)).toThrow();
    expect(() => commissionFee(100, 5001)).toThrow();
  });
  it('line amounts allow half quantities', () => {
    expect(lineAmount(1.5, rupees(600))).toBe(rupees(900));
    expect(() => lineAmount(1.234, 100)).toThrow();
  });
  it('formats PKR', () => {
    expect(formatPkr(rupees(1250))).toBe('PKR 1,250');
    expect(formatPkr(98_72)).toBe('PKR 98.72');
  });
});

describe('phone normalisation (+92)', () => {
  it.each([
    ['0300 1234567', '+923001234567'], ['03001234567', '+923001234567'], ['+92 300 1234567', '+923001234567'],
    ['923001234567', '+923001234567'], ['0092-300-1234567', '+923001234567'], ['3001234567', '+923001234567'],
  ])('%s -> %s', (input, out) => expect(normalizePkMobile(input)).toBe(out));
  it.each(['051 1234567', '+44 7700 900123', '0300123456', 'abc', '04001234567'])('rejects %s', (input) => {
    expect(normalizePkMobile(input)).toBeNull();
  });
  it('masks', () => expect(maskPhone('+923001234567')).toBe('+92 300 ***4567'));
});

describe('booking state machine', () => {
  it('allows only listed transitions per actor', () => {
    expect(canTransition('requested', 'assigned', 'system')).toBe(true);
    expect(canTransition('requested', 'assigned', 'provider')).toBe(false);
    expect(canTransition('on_site', 'in_progress', 'provider')).toBe(true);
    expect(canTransition('on_site', 'cancelled', 'customer')).toBe(false);
    expect(canTransition('completed', 'closed', 'customer')).toBe(true);
    expect(canTransition('closed', 'requested', 'dispatcher')).toBe(false);
    expect(canTransition('cancelled', 'requested', 'dispatcher')).toBe(false);
  });
  it('customer can cancel only before arrival', () => {
    expect(allowedTargets('requested', 'customer')).toContain('cancelled');
    expect(allowedTargets('en_route', 'customer')).toContain('cancelled');
    expect(allowedTargets('on_site', 'customer')).not.toContain('cancelled');
  });
});

describe('deterministic ids', () => {
  it('are stable and UUID-shaped', () => {
    expect(detId('x')).toBe(detId('x'));
    expect(detId('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
