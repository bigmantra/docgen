import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { config } from 'dotenv';
import { pollerService } from '../../src/worker';
import { getSalesforceAuth } from '../../src/sf/auth';
import { SalesforceApi } from '../../src/sf/api';
import type { DocgenRequest } from '../../src/types';

// Load environment variables from .env file
config();

// Get Salesforce credentials from environment
const SF_DOMAIN = process.env.SF_DOMAIN;
const SF_USERNAME = process.env.SF_USERNAME;
const SF_CLIENT_ID = process.env.SF_CLIENT_ID;
const SF_PRIVATE_KEY_PATH = process.env.SF_PRIVATE_KEY_PATH;

// Check if we have all required credentials
const hasCredentials = !!(SF_DOMAIN && SF_USERNAME && SF_CLIENT_ID && (process.env.SF_PRIVATE_KEY || SF_PRIVATE_KEY_PATH));

// Conditionally run integration tests only when credentials are available
const describeIntegration = hasCredentials ? describe : describe.skip;

if (!hasCredentials) {
  console.log(`
================================================================================
SKIPPING POLLER INTEGRATION TESTS: Missing Salesforce credentials.

To run these tests locally, create a .env file with:
  SF_DOMAIN=your-domain.my.salesforce.com
  SF_USERNAME=your-username@example.com
  SF_CLIENT_ID=your-connected-app-client-id
  SF_PRIVATE_KEY=your-rsa-private-key (or SF_PRIVATE_KEY_PATH=/path/to/key)

For CI/CD, set these as environment variables or secrets.
================================================================================
  `);
}

describeIntegration('Poller Service - Integration Tests with Real Salesforce', () => {
  let sfApi: SalesforceApi;
  let testTemplateId: string;
  let generatedDocumentId: string;

  beforeAll(async () => {
    // Set up environment for tests
    process.env.NODE_ENV = 'development';
    process.env.SF_DOMAIN = SF_DOMAIN;
    process.env.SF_USERNAME = SF_USERNAME;
    process.env.SF_CLIENT_ID = SF_CLIENT_ID;

    // Initialize Salesforce API
    const sfAuth = getSalesforceAuth();
    if (!sfAuth) {
      throw new Error('Failed to initialize Salesforce auth');
    }
    sfApi = new SalesforceApi(sfAuth, `https://${SF_DOMAIN}`);

    // Upload a test template to Salesforce
    const { createTestDocxBuffer } = await import('../helpers/test-docx');
    const docxTemplate = await createTestDocxBuffer();

    try {
      const uploadResponse = await sfApi.post(
        '/services/data/v59.0/sobjects/ContentVersion',
        {
          Title: 'Test Template for Poller Integration Tests',
          PathOnClient: 'test-poller-template.docx',
          VersionData: docxTemplate.toString('base64'),
        }
      );
      testTemplateId = uploadResponse.id;
      console.log(`Test template uploaded with ID: ${testTemplateId}`);
    } catch (error) {
      console.error('Failed to upload test template:', error);
      throw error;
    }
  });

  afterAll(async () => {
    // Clean up: Delete test records
    if (generatedDocumentId) {
      try {
        await sfApi.delete(
          `/services/data/v59.0/sobjects/Generated_Document__c/${generatedDocumentId}`
        );
        console.log(`Cleaned up Generated_Document__c: ${generatedDocumentId}`);
      } catch (error) {
        console.warn('Failed to clean up Generated_Document__c:', error);
      }
    }

    if (testTemplateId) {
      try {
        // Query for ContentDocumentId
        const query = `SELECT ContentDocumentId FROM ContentVersion WHERE Id = '${testTemplateId}'`;
        const queryResponse = await sfApi.get<{ records: Array<{ ContentDocumentId: string }> }>(
          `/services/data/v59.0/query?q=${encodeURIComponent(query)}`
        );
        if (queryResponse.records && queryResponse.records.length > 0) {
          const contentDocumentId = queryResponse.records[0].ContentDocumentId;
          await sfApi.delete(`/services/data/v59.0/sobjects/ContentDocument/${contentDocumentId}`);
          console.log(`Cleaned up ContentDocument: ${contentDocumentId}`);
        }
      } catch (error) {
        console.warn('Failed to clean up ContentDocument:', error);
      }
    }

    // Ensure poller is stopped
    if (pollerService.isRunning()) {
      await pollerService.stop();
    }
  });

  it('should process a QUEUED document end-to-end', async () => {
    // Prepare request JSON
    const requestEnvelope: DocgenRequest = {
      templateId: testTemplateId,
      outputFileName: 'Test_Integration_Output.pdf',
      outputFormat: 'PDF',
      locale: 'en-GB',
      timezone: 'Europe/London',
      options: {
        storeMergedDocx: false,
        returnDocxToBrowser: false,
      },
      data: {
        Account: {
          Name: 'Integration Test Account',
          AnnualRevenue__formatted: '£1,000,000',
        },
      },
      parents: {
        AccountId: null,
        OpportunityId: null,
        CaseId: null,
      },
      requestHash: 'sha256:integration-test-hash-' + Date.now(),
    };

    // Create a Generated_Document__c record with Status=QUEUED
    const createResponse = await sfApi.post(
      '/services/data/v59.0/sobjects/Generated_Document__c',
      {
        Status__c: 'QUEUED',
        RequestJSON__c: JSON.stringify(requestEnvelope),
        RequestHash__c: requestEnvelope.requestHash,
        CorrelationId__c: 'integration-test-' + Date.now(),
        Attempts__c: 0,
      }
    );

    expect(createResponse.success).toBe(true);
    generatedDocumentId = createResponse.id;
    console.log(`Created Generated_Document__c with ID: ${generatedDocumentId}`);

    // Run a single poll cycle (not starting the continuous loop)
    await pollerService.processBatch();

    // Wait a bit for async processing to complete
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Query the document to check its status
    const query = `SELECT Id, Status__c, OutputFileId__c, Error__c FROM Generated_Document__c WHERE Id = '${generatedDocumentId}'`;
    const queryResponse = await sfApi.get<{ records: Array<{
      Id: string;
      Status__c: string;
      OutputFileId__c: string | null;
      Error__c: string | null;
    }> }>(
      `/services/data/v59.0/query?q=${encodeURIComponent(query)}`
    );

    expect(queryResponse.records).toHaveLength(1);
    const document = queryResponse.records[0];

    console.log('Document status:', document.Status__c);
    console.log('Output file ID:', document.OutputFileId__c);
    console.log('Error:', document.Error__c);

    // Verify the document was processed successfully
    expect(document.Status__c).toBe('SUCCEEDED');
    expect(document.OutputFileId__c).toBeTruthy();
    expect(document.Error__c).toBeFalsy();
  }, 60000); // 60 second timeout for LibreOffice conversion

  it('should handle invalid template (404) with non-retryable error', async () => {
    // Create a request with a non-existent template ID
    const requestEnvelope: DocgenRequest = {
      templateId: '068000000000000AAA', // Invalid ContentVersionId
      outputFileName: 'Invalid_Template_Test.pdf',
      outputFormat: 'PDF',
      locale: 'en-GB',
      timezone: 'Europe/London',
      options: {
        storeMergedDocx: false,
        returnDocxToBrowser: false,
      },
      data: {
        Account: {
          Name: 'Test Account',
        },
      },
      parents: {
        AccountId: null,
        OpportunityId: null,
        CaseId: null,
      },
      requestHash: 'sha256:integration-test-invalid-' + Date.now(),
    };

    // Create Generated_Document__c
    const createResponse = await sfApi.post(
      '/services/data/v59.0/sobjects/Generated_Document__c',
      {
        Status__c: 'QUEUED',
        RequestJSON__c: JSON.stringify(requestEnvelope),
        RequestHash__c: requestEnvelope.requestHash,
        CorrelationId__c: 'integration-test-invalid-' + Date.now(),
        Attempts__c: 0,
      }
    );

    const testDocId = createResponse.id;

    try {
      // Process the batch
      await pollerService.processBatch();

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Query the document
      const query = `SELECT Id, Status__c, Error__c, Attempts__c FROM Generated_Document__c WHERE Id = '${testDocId}'`;
      const queryResponse = await sfApi.get<{ records: Array<{
        Id: string;
        Status__c: string;
        Error__c: string | null;
        Attempts__c: number;
      }> }>(
        `/services/data/v59.0/query?q=${encodeURIComponent(query)}`
      );

      const document = queryResponse.records[0];

      // Should be marked as FAILED immediately (non-retryable)
      expect(document.Status__c).toBe('FAILED');
      expect(document.Error__c).toContain('not found');
      expect(document.Attempts__c).toBe(1); // Only 1 attempt for non-retryable
    } finally {
      // Clean up
      try {
        await sfApi.delete(`/services/data/v59.0/sobjects/Generated_Document__c/${testDocId}`);
      } catch (error) {
        console.warn('Failed to clean up test document:', error);
      }
    }
  }, 30000); // 30 second timeout

  it('should respect lock TTL and not double-process', async () => {
    // Create a document
    const requestEnvelope: DocgenRequest = {
      templateId: testTemplateId,
      outputFileName: 'Lock_Test.pdf',
      outputFormat: 'PDF',
      locale: 'en-GB',
      timezone: 'Europe/London',
      options: {
        storeMergedDocx: false,
        returnDocxToBrowser: false,
      },
      data: {
        Account: {
          Name: 'Lock Test Account',
        },
      },
      parents: {
        AccountId: null,
        OpportunityId: null,
        CaseId: null,
      },
      requestHash: 'sha256:integration-test-lock-' + Date.now(),
    };

    const createResponse = await sfApi.post(
      '/services/data/v59.0/sobjects/Generated_Document__c',
      {
        Status__c: 'QUEUED',
        RequestJSON__c: JSON.stringify(requestEnvelope),
        RequestHash__c: requestEnvelope.requestHash,
        CorrelationId__c: 'integration-test-lock-' + Date.now(),
        Attempts__c: 0,
      }
    );

    const testDocId = createResponse.id;

    try {
      // Manually lock the document (simulating another worker)
      const lockUntil = new Date(Date.now() + 120000).toISOString(); // 2 minutes
      await sfApi.patch(
        `/services/data/v59.0/sobjects/Generated_Document__c/${testDocId}`,
        {
          Status__c: 'PROCESSING',
          LockedUntil__c: lockUntil,
        }
      );

      // Try to process - should skip the locked document
      await pollerService.processBatch();

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Query the document - should still be PROCESSING
      const query = `SELECT Id, Status__c FROM Generated_Document__c WHERE Id = '${testDocId}'`;
      const queryResponse = await sfApi.get<{ records: Array<{
        Id: string;
        Status__c: string;
      }> }>(
        `/services/data/v59.0/query?q=${encodeURIComponent(query)}`
      );

      const document = queryResponse.records[0];

      // Should still be PROCESSING (not processed by poller)
      expect(document.Status__c).toBe('PROCESSING');
    } finally {
      // Clean up
      try {
        await sfApi.delete(`/services/data/v59.0/sobjects/Generated_Document__c/${testDocId}`);
      } catch (error) {
        console.warn('Failed to clean up test document:', error);
      }
    }
  }, 30000); // 30 second timeout
});
