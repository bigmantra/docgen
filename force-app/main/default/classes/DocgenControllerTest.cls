/**
 * Test class for DocgenController
 * Tests the interactive document generation flow with HTTP callout mocking
 */
@isTest
private class DocgenControllerTest {

    /**
     * Mock HTTP callout for successful document generation
     */
    private class MockDocgenSuccessCallout implements HttpCalloutMock {
        public HTTPResponse respond(HTTPRequest req) {
            // Verify request structure
            Assert.areEqual('POST', req.getMethod(), 'HTTP method should be POST');
            Assert.areEqual('callout:Docgen_Node_API/generate', req.getEndpoint(), 'Should call Named Credential endpoint');
            Assert.isTrue(req.getHeader('Content-Type').contains('application/json'), 'Content-Type should be JSON');

            // Parse and verify request body
            Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(req.getBody());
            Assert.isNotNull(body.get('templateId'), 'Request should include templateId');
            Assert.isNotNull(body.get('requestHash'), 'Request should include requestHash');
            Assert.isNotNull(body.get('data'), 'Request should include data');

            // Create successful response
            HTTPResponse res = new HTTPResponse();
            res.setStatusCode(200);
            res.setStatus('OK');
            res.setHeader('Content-Type', 'application/json');

            Map<String, Object> responseBody = new Map<String, Object>{
                'downloadUrl' => 'https://test.my.salesforce.com/sfc/servlet.shepherd/version/download/068XXXXXXXXXXXXXXX',
                'contentVersionId' => '068XXXXXXXXXXXXXXX',
                'correlationId' => 'test-correlation-id-12345'
            };
            res.setBody(JSON.serialize(responseBody));

            return res;
        }
    }

    /**
     * Mock HTTP callout for server error (500)
     */
    private class MockDocgenServerErrorCallout implements HttpCalloutMock {
        public HTTPResponse respond(HTTPRequest req) {
            HTTPResponse res = new HTTPResponse();
            res.setStatusCode(500);
            res.setStatus('Internal Server Error');
            res.setHeader('Content-Type', 'application/json');

            Map<String, Object> errorBody = new Map<String, Object>{
                'error' => 'LibreOffice conversion failed',
                'correlationId' => 'error-correlation-id'
            };
            res.setBody(JSON.serialize(errorBody));

            return res;
        }
    }

    /**
     * Mock HTTP callout for client error (400)
     */
    private class MockDocgenClientErrorCallout implements HttpCalloutMock {
        public HTTPResponse respond(HTTPRequest req) {
            HTTPResponse res = new HTTPResponse();
            res.setStatusCode(400);
            res.setStatus('Bad Request');
            res.setHeader('Content-Type', 'application/json');

            Map<String, Object> errorBody = new Map<String, Object>{
                'error' => 'Invalid templateId format',
                'correlationId' => 'validation-error-id'
            };
            res.setBody(JSON.serialize(errorBody));

            return res;
        }
    }

    /**
     * Test setup: Create test data
     */
    @testSetup
    static void setup() {
        // Create test template
        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Test Account Template',
            TemplateContentVersionId__c = '068000000000001AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name, AnnualRevenue FROM Account WHERE Id = :recordId',
            StoreMergedDocx__c = false,
            ReturnDocxToBrowser__c = false,
            PrimaryParent__c = 'Account'
        );
        insert template;

        // Create test Account
        Account acc = new Account(
            Name = 'Test Account Ltd',
            AnnualRevenue = 1200000
        );
        insert acc;
    }

    /**
     * Test 1: Successful document generation (200 response)
     * Given: Valid templateId and recordId
     * When: generate() is called
     * Then: Generated_Document__c created with SUCCEEDED status, downloadUrl returned
     */
    @isTest
    static void testGenerateSuccess() {
        // Given
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];
        Account acc = [SELECT Id FROM Account LIMIT 1];

        // Set mock callout
        Test.setMock(HttpCalloutMock.class, new MockDocgenSuccessCallout());

        // When
        Test.startTest();
        String downloadUrl = DocgenController.generate(template.Id, acc.Id, 'PDF');
        Test.stopTest();

        // Then - Verify return value
        Assert.isNotNull(downloadUrl, 'Download URL should be returned');
        Assert.isTrue(downloadUrl.contains('salesforce.com'), 'Download URL should be Salesforce file URL');
        Assert.isTrue(downloadUrl.contains('068XXXXXXXXXXXXXXX'), 'Download URL should contain ContentVersionId');

        // Then - Verify Generated_Document__c record created and updated
        List<Generated_Document__c> docs = [
            SELECT Id, Status__c, RequestHash__c, OutputFileId__c, Error__c, CorrelationId__c, RequestJSON__c
            FROM Generated_Document__c
            WHERE Account__c = :acc.Id
        ];
        Assert.areEqual(1, docs.size(), 'One Generated_Document__c should be created');

        Generated_Document__c doc = docs[0];
        Assert.areEqual('SUCCEEDED', doc.Status__c, 'Status should be SUCCEEDED');
        Assert.areEqual('068XXXXXXXXXXXXXXX', doc.OutputFileId__c, 'OutputFileId should be set');
        Assert.isNotNull(doc.RequestHash__c, 'RequestHash should be set');
        Assert.isNotNull(doc.CorrelationId__c, 'CorrelationId should be captured');
        Assert.isNull(doc.Error__c, 'Error__c should be null on success');
        Assert.isNotNull(doc.RequestJSON__c, 'RequestJSON should be stored');
    }

    /**
     * Test 2: Server error handling (500 response)
     * Given: Valid request but server fails
     * When: generate() is called
     * Then: Generated_Document__c created with FAILED status, exception thrown
     */
    @isTest
    static void testGenerateServerError() {
        // Given
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];
        Account acc = [SELECT Id FROM Account LIMIT 1];

        // Set mock callout
        Test.setMock(HttpCalloutMock.class, new MockDocgenServerErrorCallout());

        // When/Then - Expect exception
        Test.startTest();
        try {
            DocgenController.generate(template.Id, acc.Id, 'PDF');
            Assert.fail('Should have thrown AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('500'), 'Error message should mention status code');
        }
        Test.stopTest();

        // Then - Verify Generated_Document__c record marked as FAILED
        List<Generated_Document__c> docs = [
            SELECT Id, Status__c, Error__c, OutputFileId__c
            FROM Generated_Document__c
            WHERE Account__c = :acc.Id
        ];
        Assert.areEqual(1, docs.size(), 'One Generated_Document__c should be created');

        Generated_Document__c doc = docs[0];
        Assert.areEqual('FAILED', doc.Status__c, 'Status should be FAILED');
        Assert.isNotNull(doc.Error__c, 'Error__c should be populated');
        Assert.isTrue(doc.Error__c.contains('500'), 'Error message should include status code');
        Assert.isNull(doc.OutputFileId__c, 'OutputFileId should be null on failure');
    }

    /**
     * Test 3: Client error handling (400 response)
     * Given: Invalid payload sent to API
     * When: generate() is called
     * Then: Generated_Document__c created with FAILED status, exception thrown
     */
    @isTest
    static void testGenerateClientError() {
        // Given
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];
        Account acc = [SELECT Id FROM Account LIMIT 1];

        // Set mock callout
        Test.setMock(HttpCalloutMock.class, new MockDocgenClientErrorCallout());

        // When/Then - Expect exception
        Test.startTest();
        try {
            DocgenController.generate(template.Id, acc.Id, 'PDF');
            Assert.fail('Should have thrown AuraHandledException');
        } catch (AuraHandledException e) {
            Assert.isTrue(e.getMessage().contains('400'), 'Error message should mention status code');
        }
        Test.stopTest();

        // Then - Verify Generated_Document__c record marked as FAILED
        List<Generated_Document__c> docs = [
            SELECT Id, Status__c, Error__c
            FROM Generated_Document__c
            WHERE Account__c = :acc.Id
        ];
        Assert.areEqual(1, docs.size(), 'One Generated_Document__c should be created');
        Assert.areEqual('FAILED', docs[0].Status__c, 'Status should be FAILED');
        Assert.isNotNull(docs[0].Error__c, 'Error__c should be populated');
    }

    /**
     * Test 4: Idempotency via RequestHash
     * Given: Same request made twice
     * When: generate() is called twice with identical inputs
     * Then: Both calls succeed, RequestHash prevents duplicate work server-side
     */
    @isTest
    static void testIdempotency() {
        // Given
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];
        Account acc = [SELECT Id FROM Account LIMIT 1];

        // Set mock callout
        Test.setMock(HttpCalloutMock.class, new MockDocgenSuccessCallout());

        // When - Call twice with same parameters
        Test.startTest();
        String url1 = DocgenController.generate(template.Id, acc.Id, 'PDF');
        String url2 = DocgenController.generate(template.Id, acc.Id, 'PDF');
        Test.stopTest();

        // Then - Both should return URLs
        Assert.isNotNull(url1, 'First call should return URL');
        Assert.isNotNull(url2, 'Second call should return URL');

        // Then - Verify RequestHash is identical
        List<Generated_Document__c> docs = [
            SELECT Id, RequestHash__c
            FROM Generated_Document__c
            WHERE Account__c = :acc.Id
            ORDER BY CreatedDate ASC
        ];
        Assert.areEqual(2, docs.size(), 'Two Generated_Document__c records should exist');
        Assert.areEqual(docs[0].RequestHash__c, docs[1].RequestHash__c, 'RequestHash should be identical');
    }

    /**
     * Test 5: Missing template handling
     * Given: Invalid templateId
     * When: generate() is called
     * Then: Exception thrown, no record created
     */
    @isTest
    static void testMissingTemplate() {
        // Given
        Account acc = [SELECT Id FROM Account LIMIT 1];
        Id fakeTemplateId = '001000000000000AAA'; // Non-existent ID

        // When/Then - Expect exception
        Test.startTest();
        try {
            DocgenController.generate(fakeTemplateId, acc.Id, 'PDF');
            Assert.fail('Should have thrown exception for missing template');
        } catch (Exception e) {
            Assert.isNotNull(e, 'Exception should be thrown');
            // Could be QueryException or AuraHandledException depending on implementation
        }
        Test.stopTest();

        // Then - Verify no Generated_Document__c created
        List<Generated_Document__c> docs = [
            SELECT Id
            FROM Generated_Document__c
            WHERE Account__c = :acc.Id
        ];
        Assert.areEqual(0, docs.size(), 'No Generated_Document__c should be created for invalid template');
    }

    /**
     * Test 6: Record status transitions
     * Given: Valid request
     * When: generate() is called
     * Then: Status transitions from PROCESSING to SUCCEEDED correctly
     */
    @isTest
    static void testRecordStatusTransitions() {
        // Given
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];
        Account acc = [SELECT Id FROM Account LIMIT 1];

        // Set mock callout
        Test.setMock(HttpCalloutMock.class, new MockDocgenSuccessCallout());

        // When
        Test.startTest();
        DocgenController.generate(template.Id, acc.Id, 'PDF');
        Test.stopTest();

        // Then - Verify final status (we can't check intermediate PROCESSING state in tests due to DML ordering)
        Generated_Document__c doc = [
            SELECT Id, Status__c, Attempts__c, RequestedBy__c, OutputFormat__c, Template__c
            FROM Generated_Document__c
            WHERE Account__c = :acc.Id
            LIMIT 1
        ];

        Assert.areEqual('SUCCEEDED', doc.Status__c, 'Final status should be SUCCEEDED');
        Assert.areEqual('PDF', doc.OutputFormat__c, 'OutputFormat should match request');
        Assert.areEqual(template.Id, doc.Template__c, 'Template lookup should be set');
        Assert.areEqual(UserInfo.getUserId(), doc.RequestedBy__c, 'RequestedBy should be current user');
        Assert.areEqual(0, doc.Attempts__c, 'Attempts should be 0 for interactive flow');
    }
}
