import supertest from 'supertest';
import nock from 'nock';
import { build } from '../../src/server';
import { loadConfig } from '../../src/config';
import { generateValidJWT } from '../helpers/jwt-helper';
import type { FastifyInstance } from 'fastify';

describe('Worker Routes', () => {
  let app: FastifyInstance;
  let request: ReturnType<typeof supertest>;
  const config = loadConfig();
  const sfDomain = config.sfDomain;
  const baseUrl = `https://${sfDomain}`;

  beforeAll(async () => {
    app = await build();
    await app.ready();
    request = supertest(app.server);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    nock.cleanAll();

    // Mock SF auth
    nock(baseUrl)
      .post('/services/oauth2/token')
      .reply(200, {
        access_token: 'test-token',
        instance_url: baseUrl,
        token_type: 'Bearer',
        issued_at: Date.now().toString(),
      })
      .persist();

    // Mock JWKS for AAD validation
    const jwksUri = `https://login.microsoftonline.com/${config.auth.tenantId}/discovery/v2.0/keys`;
    nock('https://login.microsoftonline.com')
      .get(`/${config.auth.tenantId}/v2.0/.well-known/openid-configuration`)
      .reply(200, {
        issuer: `https://login.microsoftonline.com/${config.auth.tenantId}/v2.0`,
        jwks_uri: jwksUri,
      })
      .persist();

    nock('https://login.microsoftonline.com')
      .get(`/${config.auth.tenantId}/discovery/v2.0/keys`)
      .reply(200, {
        keys: [
          {
            kty: 'RSA',
            use: 'sig',
            kid: 'test-key-id',
            n: 'test-modulus',
            e: 'AQAB',
          },
        ],
      })
      .persist();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('POST /worker/start', () => {
    it('should start the poller and return 200', async () => {
      const token = await generateValidJWT();

      // Mock query for queue check
      nock(baseUrl)
        .get('/services/data/v59.0/query')
        .query(true)
        .reply(200, {
          totalSize: 0,
          done: true,
          records: [],
        })
        .persist();

      const response = await request
        .post('/worker/start')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('isRunning', true);

      // Cleanup - stop the poller
      await request.post('/worker/stop').set('Authorization', `Bearer ${token}`).send();
    });

    it('should return 409 if poller is already running', async () => {
      const token = await generateValidJWT();

      // Mock query for queue check
      nock(baseUrl)
        .get('/services/data/v59.0/query')
        .query(true)
        .reply(200, {
          totalSize: 0,
          done: true,
          records: [],
        })
        .persist();

      // Start poller first time
      const firstResponse = await request
        .post('/worker/start')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(firstResponse.status).toBe(200);

      // Try to start again
      const secondResponse = await request
        .post('/worker/start')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(secondResponse.status).toBe(409);
      expect(secondResponse.body).toHaveProperty('error');
      expect(secondResponse.body.error).toContain('already running');

      // Cleanup
      await request.post('/worker/stop').set('Authorization', `Bearer ${token}`).send();
    });

    it('should require AAD authentication', async () => {
      const response = await request.post('/worker/start').send();

      expect(response.status).toBe(401);
    });

    it('should reject invalid token', async () => {
      const response = await request
        .post('/worker/start')
        .set('Authorization', 'Bearer invalid-token')
        .send();

      expect(response.status).toBe(401);
    });
  });

  describe('POST /worker/stop', () => {
    it('should stop the poller and return 200', async () => {
      const token = await generateValidJWT();

      // Mock query for queue check
      nock(baseUrl)
        .get('/services/data/v59.0/query')
        .query(true)
        .reply(200, {
          totalSize: 0,
          done: true,
          records: [],
        })
        .persist();

      // Start poller first
      await request.post('/worker/start').set('Authorization', `Bearer ${token}`).send();

      // Stop poller
      const response = await request
        .post('/worker/stop')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('isRunning', false);
    });

    it('should return 200 even if poller is not running', async () => {
      const token = await generateValidJWT();

      const response = await request
        .post('/worker/stop')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('isRunning', false);
    });

    it('should require AAD authentication', async () => {
      const response = await request.post('/worker/stop').send();

      expect(response.status).toBe(401);
    });
  });

  describe('GET /worker/status', () => {
    it('should return current poller status', async () => {
      const token = await generateValidJWT();

      const response = await request
        .get('/worker/status')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('isRunning');
      expect(response.body).toHaveProperty('currentQueueDepth');
      expect(response.body).toHaveProperty('lastPollTime');
      expect(typeof response.body.isRunning).toBe('boolean');
      expect(typeof response.body.currentQueueDepth).toBe('number');
    });

    it('should show running status when poller is active', async () => {
      const token = await generateValidJWT();

      // Mock query for queue check
      nock(baseUrl)
        .get('/services/data/v59.0/query')
        .query(true)
        .reply(200, {
          totalSize: 5,
          done: true,
          records: [],
        })
        .persist();

      // Start poller
      await request.post('/worker/start').set('Authorization', `Bearer ${token}`).send();

      const response = await request
        .get('/worker/status')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body.isRunning).toBe(true);

      // Cleanup
      await request.post('/worker/stop').set('Authorization', `Bearer ${token}`).send();
    });

    it('should require AAD authentication', async () => {
      const response = await request.get('/worker/status').send();

      expect(response.status).toBe(401);
    });
  });

  describe('GET /worker/stats', () => {
    it('should return detailed poller statistics', async () => {
      const token = await generateValidJWT();

      const response = await request
        .get('/worker/stats')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('isRunning');
      expect(response.body).toHaveProperty('currentQueueDepth');
      expect(response.body).toHaveProperty('totalProcessed');
      expect(response.body).toHaveProperty('totalSucceeded');
      expect(response.body).toHaveProperty('totalFailed');
      expect(response.body).toHaveProperty('totalRetries');
      expect(response.body).toHaveProperty('lastPollTime');
      expect(response.body).toHaveProperty('uptimeSeconds');
    });

    it('should show zero counts for new poller', async () => {
      const token = await generateValidJWT();

      const response = await request
        .get('/worker/stats')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(response.status).toBe(200);
      expect(response.body.totalProcessed).toBe(0);
      expect(response.body.totalSucceeded).toBe(0);
      expect(response.body.totalFailed).toBe(0);
      expect(response.body.totalRetries).toBe(0);
    });

    it('should require AAD authentication', async () => {
      const response = await request.get('/worker/stats').send();

      expect(response.status).toBe(401);
    });
  });

  describe('Authentication enforcement', () => {
    it('should reject requests with missing Authorization header', async () => {
      const startResponse = await request.post('/worker/start').send();
      const stopResponse = await request.post('/worker/stop').send();
      const statusResponse = await request.get('/worker/status').send();
      const statsResponse = await request.get('/worker/stats').send();

      expect(startResponse.status).toBe(401);
      expect(stopResponse.status).toBe(401);
      expect(statusResponse.status).toBe(401);
      expect(statsResponse.status).toBe(401);
    });

    it('should reject requests with malformed token', async () => {
      const token = 'not.a.valid.jwt';

      const startResponse = await request
        .post('/worker/start')
        .set('Authorization', `Bearer ${token}`)
        .send();

      expect(startResponse.status).toBe(401);
    });

    it('should include correlation ID in error responses', async () => {
      const response = await request.post('/worker/start').send();

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('correlationId');
    });
  });

  describe('Error handling', () => {
    it('should handle Salesforce connection errors gracefully on start', async () => {
      const token = await generateValidJWT();

      // Mock SF auth failure
      nock.cleanAll();
      nock(baseUrl)
        .post('/services/oauth2/token')
        .reply(500, { error: 'Internal server error' });

      const response = await request
        .post('/worker/start')
        .set('Authorization', `Bearer ${token}`)
        .send();

      // Should return error but not crash
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should return proper error structure', async () => {
      const response = await request.post('/worker/start').send();

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('correlationId');
      expect(typeof response.body.error).toBe('string');
    });
  });
});
