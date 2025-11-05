import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { build } from '../src/server';

describe('POST /generate - Data Contract Validation', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Validation failures (400)', () => {
    it('should return 400 when templateId is missing', async () => {
      const payload = {
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: { Account: { Name: 'Test' } },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('templateId');
    });

    it('should return 400 when outputFormat is invalid', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'test.pdf',
        outputFormat: 'INVALID',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: { Account: { Name: 'Test' } },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('outputFormat');
    });

    it('should return 400 when outputFileName is missing', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFormat: 'PDF',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: { Account: { Name: 'Test' } },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('outputFileName');
    });

    it('should return 400 when locale is missing', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: { Account: { Name: 'Test' } },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('locale');
    });

    it('should return 400 when timezone is missing', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-GB',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: { Account: { Name: 'Test' } },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('timezone');
    });

    it('should return 400 when options is missing', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-GB',
        timezone: 'Europe/London',
        data: { Account: { Name: 'Test' } },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('options');
    });

    it('should return 400 when data is missing', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('data');
    });
  });

  describe('Success cases (202)', () => {
    it('should return 202 with correlationId for minimal valid payload', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: { Account: { Name: 'Test Account' } },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('correlationId');
      expect(body.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('should return 202 for full valid payload with all optional fields', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'Opportunity_{{Opportunity.Name}}.pdf',
        outputFormat: 'PDF',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: true,
          returnDocxToBrowser: false,
        },
        parents: {
          AccountId: '001xx000000abcdXXX',
          OpportunityId: '006xx000000xyzABC',
          CaseId: null,
        },
        data: {
          Account: {
            Name: 'Acme Ltd',
            BillingCity: 'London',
            AnnualRevenue__formatted: '£1,200,000',
          },
          Opportunity: {
            Name: 'FY25 Renewal',
            CloseDate__formatted: '31 Oct 2025',
            TotalAmount__formatted: '£250,000',
            LineItems: [
              {
                Name: 'SKU-A',
                Qty: 10,
                UnitPrice__formatted: '£1,000',
                LineTotal__formatted: '£10,000',
              },
            ],
          },
        },
        requestHash:
          'sha256:a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('correlationId');
      expect(body.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('should accept DOCX as outputFormat', async () => {
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'test.docx',
        outputFormat: 'DOCX',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: { Account: { Name: 'Test Account' } },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        payload,
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('correlationId');
    });

    it('should handle correlation ID from header', async () => {
      const customCorrelationId = '12345678-1234-4567-89ab-123456789012';
      const payload = {
        templateId: '068xx000000abcdXXX',
        outputFileName: 'test.pdf',
        outputFormat: 'PDF',
        locale: 'en-GB',
        timezone: 'Europe/London',
        options: {
          storeMergedDocx: false,
          returnDocxToBrowser: true,
        },
        data: { Account: { Name: 'Test Account' } },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/generate',
        headers: {
          'x-correlation-id': customCorrelationId,
        },
        payload,
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body.correlationId).toBe(customCorrelationId);
    });
  });
});
