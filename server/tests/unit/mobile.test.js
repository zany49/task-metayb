import { describe, expect, it } from 'vitest';
import { mobileSchema } from '../../src/schemas/common.schemas.js';

describe('mobile number normalisation', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['98765 43210', '9876543210'],
    ['+91 98765-43210', '9876543210'],
    ['+919876543210', '9876543210'],
    ['919876543210', '9876543210'],
    ['09876543210', '9876543210'],
    ['  9123456789 ', '9123456789'],
  ])('accepts %j as %s', (input, expected) => {
    expect(mobileSchema.parse(input)).toBe(expected);
  });

  it.each(['12345', '5876543210', '98765432101', 'abcdefghij', '', '+1 415 555 0100'])('rejects %j', (input) => {
    expect(mobileSchema.safeParse(input).success).toBe(false);
  });
});
