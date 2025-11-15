import { LightningElement, wire, track } from 'lwc';
import { CurrentPageReference, NavigationMixin } from 'lightning/navigation';
import { getRecord } from 'lightning/uiRecordApi';
import getGeneratedDocuments from '@salesforce/apex/DocgenTestPageController.getGeneratedDocuments';

const ACCOUNT_FIELDS = ['Account.Id', 'Account.Name'];

const COLUMNS = [
    {
        label: 'Document Name',
        fieldName: 'Name',
        type: 'text',
        sortable: true
    },
    {
        label: 'Status',
        fieldName: 'Status__c',
        type: 'text',
        sortable: true
    },
    {
        label: 'Output Format',
        fieldName: 'OutputFormat__c',
        type: 'text'
    },
    {
        label: 'Created Date',
        fieldName: 'CreatedDate',
        type: 'date',
        typeAttributes: {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        },
        sortable: true
    },
    {
        label: 'Template',
        fieldName: 'TemplateName',
        type: 'text'
    }
];

export default class DocgenTestPage extends NavigationMixin(LightningElement) {
    @track recordId;
    @track templateId;
    @track generatedDocuments;
    columns = COLUMNS;
    pageRef;

    // Get the current page reference to read URL parameters
    @wire(CurrentPageReference)
    getPageReference(pageRef) {
        this.pageRef = pageRef;
        if (pageRef && pageRef.state) {
            // Read c__recordId and c__templateId from URL parameters
            const recordIdParam = pageRef.state.c__recordId;
            const templateIdParam = pageRef.state.c__templateId;

            if (recordIdParam && recordIdParam !== this.recordId) {
                this.recordId = recordIdParam;
                this.loadGeneratedDocuments();
            }

            if (templateIdParam && templateIdParam !== this.templateId) {
                this.templateId = templateIdParam;
            }
        }
    }

    // Handle account selection from lookup
    handleAccountSelection(event) {
        this.recordId = event.detail.recordId;

        if (this.recordId) {
            // Update URL to include the selected account ID
            this.updateUrlParams();
            this.loadGeneratedDocuments();
        } else {
            // Clear the recordId from URL
            this.updateUrlParams();
            this.generatedDocuments = null;
        }
    }

    // Handle template selection from lookup
    handleTemplateSelection(event) {
        this.templateId = event.detail.recordId;
        // Update URL to persist template selection
        this.updateUrlParams();
    }

    // Update the URL with recordId and templateId parameters
    updateUrlParams() {
        const newState = {
            ...this.pageRef.state
        };

        if (this.recordId) {
            newState.c__recordId = this.recordId;
        } else {
            delete newState.c__recordId;
        }

        if (this.templateId) {
            newState.c__templateId = this.templateId;
        } else {
            delete newState.c__templateId;
        }

        this[NavigationMixin.Navigate]({
            type: 'standard__navItemPage',
            attributes: {
                apiName: this.pageRef.attributes.apiName
            },
            state: newState
        }, true); // true = replace current history entry
    }

    // Load generated documents for the account
    loadGeneratedDocuments() {
        if (!this.recordId) {
            return;
        }

        getGeneratedDocuments({ accountId: this.recordId })
            .then(result => {
                // Transform the data to include template name from lookup
                this.generatedDocuments = result.map(doc => {
                    return {
                        ...doc,
                        TemplateName: doc.Template__r ? doc.Template__r.Name : 'N/A'
                    };
                });
            })
            .catch(error => {
                console.error('Error loading generated documents:', error);
                this.generatedDocuments = [];
            });
    }

    // Refresh documents when button generates a new one
    handleDocumentGenerated() {
        // Wait a moment for the record to be created, then refresh
        setTimeout(() => {
            this.loadGeneratedDocuments();
        }, 2000);
    }

    connectedCallback() {
        // Listen for custom event from docgenButton
        this.template.addEventListener('documentgenerated', this.handleDocumentGenerated.bind(this));
    }
}
