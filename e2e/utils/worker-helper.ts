/**
 * Worker Helper Utilities for E2E Tests
 *
 * Provides utilities for testing worker/poller functionality including:
 * - Document status polling and verification
 * - Worker statistics monitoring
 * - PDF file validation
 * - Status transition tracking
 */

import { Page } from '@playwright/test';
import { ScratchOrgHelper } from './scratch-org';

export interface DocumentStatus {
  Id: string;
  Status__c: string;
  Attempts__c: number;
  Error__c: string | null;
  OutputFileId__c: string | null;
  LockedUntil__c: string | null;
  ScheduledRetryTime__c: string | null;
}

export interface WorkerStats {
  isRunning: boolean;
  totalProcessed: number;
  totalSucceeded: number;
  totalFailed: number;
  totalRetries: number;
  currentQueueDepth: number;
  lastPollTime: string | null;
}

export class WorkerHelper {
  constructor(
    private page: Page,
    private orgHelper: ScratchOrgHelper,
    private backendUrl: string
  ) {}

  /**
   * Wait for a document to reach a specific status
   * Polls every 2 seconds with configurable max wait time
   *
   * @param documentId - Generated_Document__c record ID
   * @param expectedStatus - Expected status value (QUEUED, PROCESSING, SUCCEEDED, FAILED)
   * @param maxWaitMs - Maximum time to wait in milliseconds (default: 90000 = 90s)
   * @returns Document record when status matches
   * @throws Error if timeout or document not found
   */
  async waitForDocumentStatus(
    documentId: string,
    expectedStatus: string,
    maxWaitMs: number = 90000
  ): Promise<DocumentStatus> {
    const startTime = Date.now();
    const pollIntervalMs = 2000; // Poll every 2 seconds

    while (Date.now() - startTime < maxWaitMs) {
      const doc = await this.getDocumentStatus(documentId);

      if (doc.Status__c === expectedStatus) {
        return doc;
      }

      // Wait before next poll
      await this.page.waitForTimeout(pollIntervalMs);
    }

    // Timeout - get final status for error message
    const finalDoc = await this.getDocumentStatus(documentId);
    throw new Error(
      `Timeout waiting for document ${documentId} to reach status ${expectedStatus}. ` +
      `Current status: ${finalDoc.Status__c}, Attempts: ${finalDoc.Attempts__c}, ` +
      `Error: ${finalDoc.Error__c || 'none'}`
    );
  }

  /**
   * Get current status of a document
   */
  async getDocumentStatus(documentId: string): Promise<DocumentStatus> {
    const query = `
      SELECT Id, Status__c, Attempts__c, Error__c, OutputFileId__c,
             LockedUntil__c, ScheduledRetryTime__c
      FROM Generated_Document__c
      WHERE Id = '${documentId}'
    `;

    const result = await this.orgHelper.query<DocumentStatus>(query);

    if (result.length === 0) {
      throw new Error(`Document not found: ${documentId}`);
    }

    return result[0];
  }

  /**
   * Verify document transitions through expected status sequence
   *
   * @param documentId - Generated_Document__c record ID
   * @param expectedStatuses - Array of expected statuses in order (e.g., ['QUEUED', 'PROCESSING', 'SUCCEEDED'])
   * @param maxWaitMs - Max wait time for entire sequence
   */
  async verifyDocumentTransition(
    documentId: string,
    expectedStatuses: string[],
    maxWaitMs: number = 120000
  ): Promise<void> {
    for (const status of expectedStatuses) {
      await this.waitForDocumentStatus(documentId, status, maxWaitMs);
    }
  }

  /**
   * Wait for multiple documents to all reach a specific status
   * Useful for batch processing tests
   *
   * @param documentIds - Array of document IDs
   * @param expectedStatus - Expected final status
   * @param maxWaitMs - Maximum wait time
   */
  async waitForQueueProcessing(
    documentIds: string[],
    expectedStatus: string = 'SUCCEEDED',
    maxWaitMs: number = 180000
  ): Promise<DocumentStatus[]> {
    const startTime = Date.now();
    const pollIntervalMs = 3000; // Poll every 3 seconds for batch operations

    while (Date.now() - startTime < maxWaitMs) {
      const statuses = await this.getBatchDocumentStatuses(documentIds);

      // Check if all documents reached expected status
      const allComplete = statuses.every(doc => doc.Status__c === expectedStatus);

      if (allComplete) {
        return statuses;
      }

      // Log progress for debugging
      const completedCount = statuses.filter(doc => doc.Status__c === expectedStatus).length;
      console.log(`Batch progress: ${completedCount}/${documentIds.length} documents completed`);

      // Wait before next poll
      await this.page.waitForTimeout(pollIntervalMs);
    }

    // Timeout - get final statuses for error reporting
    const finalStatuses = await this.getBatchDocumentStatuses(documentIds);
    const statusCounts = this.countStatuses(finalStatuses);

    throw new Error(
      `Timeout waiting for ${documentIds.length} documents to reach ${expectedStatus}. ` +
      `Current: ${JSON.stringify(statusCounts)}`
    );
  }

  /**
   * Get statuses for multiple documents
   */
  async getBatchDocumentStatuses(documentIds: string[]): Promise<DocumentStatus[]> {
    const idList = documentIds.map(id => `'${id}'`).join(',');
    const query = `
      SELECT Id, Status__c, Attempts__c, Error__c, OutputFileId__c,
             LockedUntil__c, ScheduledRetryTime__c
      FROM Generated_Document__c
      WHERE Id IN (${idList})
      ORDER BY CreatedDate ASC
    `;

    return await this.orgHelper.query<DocumentStatus>(query);
  }

  /**
   * Count documents by status for reporting
   */
  private countStatuses(statuses: DocumentStatus[]): Record<string, number> {
    return statuses.reduce((acc, doc) => {
      acc[doc.Status__c] = (acc[doc.Status__c] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  /**
   * Verify that a PDF file was successfully uploaded to Salesforce
   *
   * @param contentVersionId - ContentVersion ID from OutputFileId__c
   * @returns true if PDF exists and is valid
   */
  async verifyPDFExists(contentVersionId: string): Promise<boolean> {
    const query = `
      SELECT Id, Title, FileExtension, ContentSize, VersionData
      FROM ContentVersion
      WHERE Id = '${contentVersionId}'
    `;

    const result = await this.orgHelper.query<{
      Id: string;
      Title: string;
      FileExtension: string;
      ContentSize: number;
    }>(query);

    if (result.length === 0) {
      return false;
    }

    const file = result[0];

    // Validate it's a PDF with non-zero size
    return file.FileExtension === 'pdf' && file.ContentSize > 0;
  }

  /**
   * Start the worker poller
   * Required before tests that depend on automatic document processing
   */
  async startWorker(): Promise<void> {
    const response = await this.page.request.post(`${this.backendUrl}/worker/start`);

    if (!response.ok()) {
      throw new Error(`Failed to start worker: ${response.status()} ${response.statusText()}`);
    }

    const result = await response.json();
    console.log('Worker started:', result);
  }

  /**
   * Stop the worker poller
   * Useful for test cleanup
   */
  async stopWorker(): Promise<void> {
    const response = await this.page.request.post(`${this.backendUrl}/worker/stop`);

    if (!response.ok()) {
      // Don't throw error if worker is already stopped
      if (response.status() !== 400) {
        throw new Error(`Failed to stop worker: ${response.status()} ${response.statusText()}`);
      }
    }

    const result = await response.json();
    console.log('Worker stopped:', result);
  }

  /**
   * Verify worker is running and ready to process documents
   * Should be called before tests that depend on the poller
   */
  async verifyWorkerRunning(): Promise<boolean> {
    try {
      const stats = await this.getWorkerStats();
      return stats.isRunning;
    } catch (error) {
      console.error('Failed to verify worker status:', error);
      return false;
    }
  }

  /**
   * Ensure worker is running, start it if not
   * Convenience method for test setup
   */
  async ensureWorkerRunning(): Promise<void> {
    const isRunning = await this.verifyWorkerRunning();

    if (!isRunning) {
      console.log('Worker not running, starting it now...');
      await this.startWorker();

      // Wait a moment for worker to initialize
      await this.page.waitForTimeout(2000);

      // Verify it started successfully
      const nowRunning = await this.verifyWorkerRunning();
      if (!nowRunning) {
        throw new Error('Worker failed to start');
      }

      console.log('✓ Worker is now running');
    } else {
      console.log('✓ Worker is already running');
    }
  }

  /**
   * Get worker statistics from backend
   * Requires backend URL to be accessible
   */
  async getWorkerStats(): Promise<WorkerStats> {
    const response = await this.page.request.get(`${this.backendUrl}/worker/stats`);

    if (!response.ok()) {
      throw new Error(`Failed to get worker stats: ${response.status()} ${response.statusText()}`);
    }

    return await response.json();
  }

  /**
   * Wait for worker to process at least a certain number of documents
   * Polls worker stats endpoint
   *
   * @param minimumProcessed - Minimum number of documents that should be processed
   * @param maxWaitMs - Maximum wait time
   */
  async waitForWorkerToProcess(
    minimumProcessed: number,
    maxWaitMs: number = 120000
  ): Promise<WorkerStats> {
    const startTime = Date.now();
    const pollIntervalMs = 3000;

    while (Date.now() - startTime < maxWaitMs) {
      const stats = await this.getWorkerStats();

      if (stats.totalProcessed >= minimumProcessed) {
        return stats;
      }

      console.log(`Worker processed: ${stats.totalProcessed}/${minimumProcessed}`);
      await this.page.waitForTimeout(pollIntervalMs);
    }

    const finalStats = await this.getWorkerStats();
    throw new Error(
      `Timeout waiting for worker to process ${minimumProcessed} documents. ` +
      `Current: ${finalStats.totalProcessed}`
    );
  }

  /**
   * Verify ContentDocumentLinks exist for a document
   * Checks that PDF is linked to parent records
   *
   * @param contentDocumentId - ContentDocument ID (not ContentVersion)
   * @param expectedParentIds - Array of expected parent IDs (Account, Opportunity, etc.)
   */
  async verifyContentDocumentLinks(
    contentDocumentId: string,
    expectedParentIds: string[]
  ): Promise<boolean> {
    const parentIdList = expectedParentIds.map(id => `'${id}'`).join(',');
    const query = `
      SELECT Id, LinkedEntityId, ShareType, Visibility
      FROM ContentDocumentLink
      WHERE ContentDocumentId = '${contentDocumentId}'
      AND LinkedEntityId IN (${parentIdList})
    `;

    const links = await this.orgHelper.query<{
      Id: string;
      LinkedEntityId: string;
    }>(query);

    // Verify all expected parents are linked
    const linkedParentIds = links.map(link => link.LinkedEntityId);
    return expectedParentIds.every(parentId => linkedParentIds.includes(parentId));
  }

  /**
   * Get ContentDocument ID from ContentVersion ID
   */
  async getContentDocumentId(contentVersionId: string): Promise<string> {
    const query = `
      SELECT ContentDocumentId
      FROM ContentVersion
      WHERE Id = '${contentVersionId}'
    `;

    const result = await this.orgHelper.query<{ ContentDocumentId: string }>(query);

    if (result.length === 0) {
      throw new Error(`ContentVersion not found: ${contentVersionId}`);
    }

    return result[0].ContentDocumentId;
  }

  /**
   * Wait for document to be locked by poller
   * Useful for testing lock mechanism
   */
  async waitForDocumentLock(
    documentId: string,
    maxWaitMs: number = 30000
  ): Promise<DocumentStatus> {
    const startTime = Date.now();
    const pollIntervalMs = 1000;

    while (Date.now() - startTime < maxWaitMs) {
      const doc = await this.getDocumentStatus(documentId);

      // Document is locked if LockedUntil is in the future
      if (doc.LockedUntil__c) {
        const lockTime = new Date(doc.LockedUntil__c).getTime();
        if (lockTime > Date.now()) {
          return doc;
        }
      }

      await this.page.waitForTimeout(pollIntervalMs);
    }

    throw new Error(`Timeout waiting for document ${documentId} to be locked`);
  }

  /**
   * Create a QUEUED document directly (bypassing batch)
   * Useful for testing poller in isolation
   */
  async createQueuedDocument(config: {
    templateId: string;
    accountId: string;
    outputFileName: string;
    outputFormat: string;
    requestJSON: string;
    requestHash: string;
  }): Promise<string> {
    const result = await this.orgHelper.createRecord('Generated_Document__c', {
      Template__c: config.templateId,
      Account__c: config.accountId,
      Status__c: 'QUEUED',
      OutputFormat__c: config.outputFormat,
      RequestJSON__c: config.requestJSON,
      RequestHash__c: config.requestHash,
      Priority__c: 1,
      Attempts__c: 0
    });

    return result.id;
  }
}
