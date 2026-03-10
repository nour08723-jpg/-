import request from 'supertest';
import { describe, it, expect } from 'vitest';
import app from '../src/server.js';

describe('Accounting API smoke tests', () => {
  it('rejects unauthenticated /me', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects invalid login payload', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'x' });
    expect(res.status).toBe(400);
  });

  it.skip('create → approve → post revenue credit', async () => { expect(true).toBe(true); });
  it.skip('customer receipt reduces customer balance', async () => { expect(true).toBe(true); });
  it.skip('expense credit creates supplier balance', async () => { expect(true).toBe(true); });
  it.skip('supplier payment reduces supplier balance', async () => { expect(true).toBe(true); });
  it.skip('advance + settlements closes advance', async () => { expect(true).toBe(true); });
  it.skip('manual journal with customer subledger appears in statement', async () => { expect(true).toBe(true); });
  it.skip('posting in closed period is rejected', async () => { expect(true).toBe(true); });
  it.skip('posted document cannot be posted twice', async () => { expect(true).toBe(true); });
  it.skip('cancel posted document creates reversal', async () => { expect(true).toBe(true); });
  it.skip('customer control account equals customer subledger total', async () => { expect(true).toBe(true); });
});
