import { test, expect } from '../fixtures/salesforce.fixture';
import { DocgenTestPage } from '../pages/DocgenTestPage';
import { DocgenButtonComponent } from '../pages/DocgenButtonComponent';
import { querySalesforce, waitForSalesforceRecord } from '../utils/scratch-org';

test.describe('docgenButton Component Tests', () => {
  // These tests validate the full integration: Salesforce → AAD OAuth → Node.js Backend → PDF Generation

  test('generates PDF successfully with real backend', async ({ salesforce }) => {
    console.log(`\n${'='.repeat(70)}`);
    console.log('TEST: generates PDF successfully with real backend');
    console.log(`${'='.repeat(70)}`);
    console.log(`Test Account ID: ${salesforce.testData.accountId}`);
    console.log(`Test Template ID: ${salesforce.testData.templateId}`);
    console.log(`ContentVersion ID: ${salesforce.testData.contentVersionId}`);
    console.log(`Backend URL: ${process.env.BACKEND_URL || 'Not set'}`);

    const testPage = new DocgenTestPage(salesforce.authenticatedPage);
    const button = new DocgenButtonComponent(salesforce.authenticatedPage);

    console.log('\nNavigating to Docgen test page...');
    await testPage.goto(salesforce.testData.accountId, salesforce.testData.templateId);
    await testPage.waitForAccountDetailsLoaded();
    console.log('✓ Docgen test page loaded');

    // Verify button is visible
    const isVisible = await button.isVisible();
    console.log(`Button visible: ${isVisible}`);
    expect(isVisible).toBe(true);

    // Click button
    console.log('Clicking docgen button...');
    await button.click();
    console.log('✓ Button clicked');

    // Wait for spinner to appear
    const spinnerVisible = await button.isSpinnerVisible();
    console.log(`Spinner visible after click: ${spinnerVisible}`);
    expect(spinnerVisible).toBe(true);

    // Wait for spinner to disappear (generous timeout for first conversion - LibreOffice cold start)
    console.log('Waiting for spinner to disappear (timeout: 60s)...');
    await button.waitForSpinnerToDisappear(60000);
    console.log('✓ Spinner disappeared');

    // Poll for Generated_Document__c with Status = SUCCEEDED
    console.log('\nPolling for Generated_Document__c with Status=SUCCEEDED...');
    console.log('  This may take up to 90 seconds for real PDF generation');

    const generatedDocs = await waitForSalesforceRecord(
      () => querySalesforce(
        `SELECT Id, Status__c, OutputFileId__c, Error__c, CorrelationId__c
         FROM Generated_Document__c
         WHERE Account__c = '${salesforce.testData.accountId}'
         ORDER BY CreatedDate DESC LIMIT 1`
      ),
      {
        description: 'Generated document with SUCCEEDED status',
        maxAttempts: 30, // 90 seconds total (30 * 3s)
        delayMs: 3000,
      }
    );

    expect(generatedDocs.length).toBeGreaterThan(0);
    const doc = generatedDocs[0];

    // Log the document details for debugging
    console.log('\nGenerated Document found:', {
      Id: doc.Id,
      Status__c: doc.Status__c,
      OutputFileId__c: doc.OutputFileId__c,
      Error__c: doc.Error__c,
      CorrelationId__c: doc.CorrelationId__c,
    });

    // Verify status and no errors
    expect(doc.Status__c).toBe('SUCCEEDED');
    expect(doc.Error__c).toBeNull();

    // Verify OutputFileId is populated
    expect(doc.OutputFileId__c).toBeTruthy();
    expect(doc.OutputFileId__c).toMatch(/^068/); // ContentVersion ID prefix

    // Query ContentVersion to verify PDF was uploaded
    console.log('\nVerifying PDF file was uploaded to Salesforce...');
    const contentVersions = await querySalesforce(
      `SELECT Id, Title, FileExtension, ContentSize, FileType
       FROM ContentVersion
       WHERE Id = '${doc.OutputFileId__c}'`
    );

    expect(contentVersions.length).toBe(1);
    const cv = contentVersions[0];

    console.log('ContentVersion details:', {
      Id: cv.Id,
      Title: cv.Title,
      FileExtension: cv.FileExtension,
      ContentSize: cv.ContentSize,
      FileType: cv.FileType,
    });

    // Verify it's a PDF
    expect(cv.FileExtension).toBe('pdf');
    expect(cv.FileType).toBe('PDF');

    // Verify file is not empty
    expect(cv.ContentSize).toBeGreaterThan(0);

    // Verify file title contains account name
    expect(cv.Title).toContain('TestAccount');

    console.log(`\n✅ PDF generated successfully: ${cv.Title}, Size: ${cv.ContentSize} bytes`);
  });

  test('clicking button twice reuses existing document (idempotency)', async ({ salesforce }) => {
    console.log(`\n${'='.repeat(70)}`);
    console.log('TEST: idempotency check (clicking button twice)');
    console.log(`${'='.repeat(70)}`);

    const testPage = new DocgenTestPage(salesforce.authenticatedPage);
    const button = new DocgenButtonComponent(salesforce.authenticatedPage);

    await testPage.goto(salesforce.testData.accountId, salesforce.testData.templateId);
    await testPage.waitForAccountDetailsLoaded();

    // First click
    console.log('First click...');
    await button.click();
    await button.waitForSpinnerToDisappear(60000);
    console.log('✓ First request completed');

    // Wait for document to reach SUCCEEDED state
    const firstDocs = await waitForSalesforceRecord(
      () => querySalesforce(
        `SELECT Id, OutputFileId__c, RequestHash__c FROM Generated_Document__c
         WHERE Account__c = '${salesforce.testData.accountId}'
         AND Status__c = 'SUCCEEDED'`
      ),
      { description: 'First document with SUCCEEDED', maxAttempts: 30, delayMs: 3000 }
    );

    expect(firstDocs.length).toBeGreaterThan(0);
    const firstDoc = firstDocs[0];
    console.log('First document:', { Id: firstDoc.Id, OutputFileId__c: firstDoc.OutputFileId__c });

    // Small delay to ensure UI is ready
    await salesforce.authenticatedPage.waitForTimeout(2000);

    // Second click
    console.log('Second click (should reuse existing document)...');
    await button.click();
    await button.waitForSpinnerToDisappear(30000);
    console.log('✓ Second request completed');

    // Query for all documents
    const allDocs = await querySalesforce(
      `SELECT Id, OutputFileId__c, RequestHash__c FROM Generated_Document__c
       WHERE Account__c = '${salesforce.testData.accountId}'
       ORDER BY CreatedDate DESC`
    );

    console.log(`Total Generated_Document__c records: ${allDocs.length}`);

    // Should only have ONE document (idempotency)
    expect(allDocs.length).toBe(1);

    // Should be the same document as first request
    expect(allDocs[0].Id).toBe(firstDoc.Id);
    expect(allDocs[0].OutputFileId__c).toBe(firstDoc.OutputFileId__c);

    console.log('✅ Idempotency verified: Only one document created despite two clicks');
  });
});
