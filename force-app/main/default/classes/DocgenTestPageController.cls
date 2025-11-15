/**
 * Controller for the docgenTestPage LWC component
 * Provides methods to fetch Generated_Document__c records for display in the test page
 */
public with sharing class DocgenTestPageController {

    /**
     * Get Generated_Document__c records for a given Account
     * @param accountId The Account ID to filter by
     * @return List of Generated_Document__c records with related Template data
     */
    @AuraEnabled(cacheable=true)
    public static List<Generated_Document__c> getGeneratedDocuments(Id accountId) {
        if (accountId == null) {
            return new List<Generated_Document__c>();
        }

        return [
            SELECT Id, Name, Status__c, OutputFormat__c, CreatedDate,
                   Template__c, Template__r.Name, Error__c,
                   OutputFileId__c, CorrelationId__c
            FROM Generated_Document__c
            WHERE Account__c = :accountId
            ORDER BY CreatedDate DESC
            LIMIT 50
        ];
    }
}
