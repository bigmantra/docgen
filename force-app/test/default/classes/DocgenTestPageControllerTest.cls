/**
 * Test class for DocgenTestPageController
 */
@isTest
private class DocgenTestPageControllerTest {

    @testSetup
    static void setup() {
        // Create test account
        Account testAccount = new Account(
            Name = 'Test Account',
            Type = 'Customer',
            Industry = 'Technology'
        );
        insert testAccount;

        // Create test template
        Docgen_Template__c template = new Docgen_Template__c(
            Name = 'Test Template',
            TemplateContentVersionId__c = '068000000000000AAA',
            DataSource__c = 'SOQL',
            SOQL__c = 'SELECT Id, Name FROM Account WHERE Id = :recordId',
            PrimaryParent__c = 'Account'
        );
        insert template;

        // Create test generated documents
        List<Generated_Document__c> docs = new List<Generated_Document__c>();
        for (Integer i = 0; i < 3; i++) {
            docs.add(new Generated_Document__c(
                Account__c = testAccount.Id,
                Template__c = template.Id,
                Status__c = 'SUCCEEDED',
                OutputFormat__c = 'PDF',
                RequestHash__c = 'test-hash-' + i,
                CorrelationId__c = 'test-corr-' + i
            ));
        }
        insert docs;
    }

    @isTest
    static void testGetGeneratedDocuments_withValidAccountId() {
        // Get test account
        Account testAccount = [SELECT Id FROM Account LIMIT 1];

        // Test
        Test.startTest();
        List<Generated_Document__c> result = DocgenTestPageController.getGeneratedDocuments(testAccount.Id);
        Test.stopTest();

        // Verify
        System.assertEquals(3, result.size(), 'Should return 3 generated documents');
        System.assertNotEquals(null, result[0].Template__r, 'Should include template lookup');
        System.assertEquals('Test Template', result[0].Template__r.Name, 'Should include template name');
    }

    @isTest
    static void testGetGeneratedDocuments_withNullAccountId() {
        // Test
        Test.startTest();
        List<Generated_Document__c> result = DocgenTestPageController.getGeneratedDocuments(null);
        Test.stopTest();

        // Verify
        System.assertEquals(0, result.size(), 'Should return empty list for null account ID');
    }

    @isTest
    static void testGetGeneratedDocuments_withNonExistentAccount() {
        // Create a fake account ID that doesn't exist
        Id fakeAccountId = '001000000000000AAA';

        // Test
        Test.startTest();
        List<Generated_Document__c> result = DocgenTestPageController.getGeneratedDocuments(fakeAccountId);
        Test.stopTest();

        // Verify
        System.assertEquals(0, result.size(), 'Should return empty list for non-existent account');
    }

    @isTest
    static void testGetGeneratedDocuments_orderingAndLimit() {
        // Get test account
        Account testAccount = [SELECT Id FROM Account LIMIT 1];
        Docgen_Template__c template = [SELECT Id FROM Docgen_Template__c LIMIT 1];

        // Create more documents to test limit
        List<Generated_Document__c> moreDocs = new List<Generated_Document__c>();
        for (Integer i = 10; i < 60; i++) {
            moreDocs.add(new Generated_Document__c(
                Account__c = testAccount.Id,
                Template__c = template.Id,
                Status__c = 'QUEUED',
                OutputFormat__c = 'PDF',
                RequestHash__c = 'test-hash-' + i,
                CorrelationId__c = 'test-corr-' + i
            ));
        }
        insert moreDocs;

        // Test
        Test.startTest();
        List<Generated_Document__c> result = DocgenTestPageController.getGeneratedDocuments(testAccount.Id);
        Test.stopTest();

        // Verify
        System.assertEquals(50, result.size(), 'Should respect LIMIT 50');
        // Verify ordering (newest first)
        System.assert(result[0].CreatedDate >= result[result.size()-1].CreatedDate,
                     'Results should be ordered by CreatedDate DESC');
    }
}
