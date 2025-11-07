import { LightningElement, api, track } from 'lwc';
import generate from '@salesforce/apex/DocgenController.generate';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

/**
 * LWC component for interactive document generation
 * Allows users to generate PDF/DOCX documents from Salesforce records
 *
 * @component docgenButton
 * @example
 * <c-docgen-button
 *   template-id="a0X1234567890ABC"
 *   output-format="PDF"
 *   button-label="Generate Contract"
 *   success-message="Contract generated successfully!">
 * </c-docgen-button>
 */
export default class DocgenButton extends LightningElement {
  /**
   * Template ID (Docgen_Template__c record ID)
   * @type {string}
   * @required
   */
  @api templateId;

  /**
   * Output format (PDF or DOCX)
   * @type {string}
   * @required
   */
  @api outputFormat;

  /**
   * Current record ID (automatically provided by Lightning runtime)
   * @type {string}
   */
  @api recordId;

  /**
   * Custom button label
   * @type {string}
   * @default 'Generate Document'
   */
  @api buttonLabel = 'Generate Document';

  /**
   * Custom success message for toast
   * @type {string}
   * @default 'Document generated successfully!'
   */
  @api successMessage = 'Document generated successfully!';

  /**
   * Tracks whether document generation is in progress
   * @type {boolean}
   * @private
   */
  @track isProcessing = false;

  /**
   * Handles button click event
   * Validates required properties, calls Apex, and handles response
   * @private
   */
  handleGenerateClick() {
    // Validate required properties
    if (!this.templateId) {
      this.showToast(
        'Configuration Error',
        'Template ID is required. Please configure the component.',
        'error'
      );
      return;
    }

    if (!this.outputFormat) {
      this.showToast(
        'Configuration Error',
        'Output Format is required. Please configure the component.',
        'error'
      );
      return;
    }

    // Start processing
    this.isProcessing = true;

    // Call Apex method
    generate({
      templateId: this.templateId,
      recordId: this.recordId,
      outputFormat: this.outputFormat
    })
      .then((downloadUrl) => {
        // Success: Open download URL in new tab
        window.open(downloadUrl, '_blank');

        // Show success toast
        this.showToast('Success', this.successMessage, 'success');
      })
      .catch((error) => {
        // Error: Extract and display error message
        const errorMessage = this.extractErrorMessage(error);
        this.showToast('Error Generating Document', errorMessage, 'error');
      })
      .finally(() => {
        // Always re-enable button
        this.isProcessing = false;
      });
  }

  /**
   * Displays a toast notification
   * @param {string} title - Toast title
   * @param {string} message - Toast message
   * @param {string} variant - Toast variant (success, error, warning, info)
   * @private
   */
  showToast(title, message, variant) {
    const event = new ShowToastEvent({
      title,
      message,
      variant
    });
    this.dispatchEvent(event);
  }

  /**
   * Extracts error message from various error formats
   * @param {Object|Error} error - Error object from Apex or JavaScript
   * @returns {string} Human-readable error message
   * @private
   */
  extractErrorMessage(error) {
    // Handle AuraHandledException (Apex error)
    if (error?.body?.message) {
      return error.body.message;
    }

    // Handle standard JavaScript Error
    if (error?.message) {
      return error.message;
    }

    // Handle array of errors
    if (error?.body?.pageErrors && error.body.pageErrors.length > 0) {
      return error.body.pageErrors[0].message;
    }

    // Handle field errors
    if (error?.body?.fieldErrors) {
      const fieldErrorMessages = [];
      Object.keys(error.body.fieldErrors).forEach((field) => {
        error.body.fieldErrors[field].forEach((fieldError) => {
          fieldErrorMessages.push(fieldError.message);
        });
      });
      if (fieldErrorMessages.length > 0) {
        return fieldErrorMessages.join(', ');
      }
    }

    // Default error message
    return 'An unexpected error occurred. Please try again or contact your administrator.';
  }
}
