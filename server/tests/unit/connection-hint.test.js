import { describe, expect, it } from 'vitest';
import { connectionHint } from '../../src/db/connect.js';

describe('Atlas connection hints', () => {
  it('explains a wrong username or password', () => {
    expect(connectionHint(new Error('bad auth : authentication failed'))).toMatch(/Database Access/);
  });

  it('explains a wrong cluster address', () => {
    expect(connectionHint(new Error('querySrv ENOTFOUND _mongodb._tcp.cluster0.abcd.mongodb.net'))).toMatch(
      /Cluster address not found/,
    );
  });

  it('explains a blocked IP address', () => {
    const err = new Error(
      "Could not connect to any servers in your MongoDB Atlas cluster. One common reason is that you're " +
        "trying to access the database from an IP that isn't whitelisted.",
    );
    expect(connectionHint(err)).toMatch(/Network Access/);
  });

  it('gives no hint for unrelated errors', () => {
    expect(connectionHint(new Error('something else'))).toBeUndefined();
  });
});
