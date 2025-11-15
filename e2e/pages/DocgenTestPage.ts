import { Page, expect } from '@playwright/test';
import { getScratchOrgInfo } from '../utils/scratch-org';

/**
 * Page Object for the Docgen Test Page (App Page)
 * Navigates to the custom app page with recordId parameter and interacts with the docgenButton component
 */
export class DocgenTestPage {
  readonly page: Page;
  private baseUrl: string | null = null;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Get base URL from scratch org info
   */
  private async getBaseUrl(): Promise<string> {
    if (!this.baseUrl) {
      const orgInfo = await getScratchOrgInfo();
      this.baseUrl = orgInfo.instanceUrl;
    }
    return this.baseUrl;
  }

  /**
   * Navigate to the Docgen Test Page with the specified Account recordId and optional Template ID
   * @param accountId - The Account ID to pass as c__recordId parameter
   * @param templateId - Optional Template ID to pass as c__templateId parameter
   */
  async goto(accountId: string, templateId?: string) {
    const baseUrl = await this.getBaseUrl();
    let url = `${baseUrl}/lightning/n/Docgen_Test_Page?c__recordId=${accountId}`;

    if (templateId) {
      url += `&c__templateId=${templateId}`;
    }

    // Use 'load' instead of 'networkidle' as Salesforce pages have continuous polling
    await this.page.goto(url, { waitUntil: 'load', timeout: 60000 });

    // Wait for the main docgen test page component
    await this.page.waitForSelector('c-docgen-test-page', { state: 'attached', timeout: 30000 });

    // If templateId is provided, wait for button to be visible
    // Otherwise, user needs to select template first
    if (templateId) {
      await this.page.waitForSelector('c-docgen-button', { state: 'visible', timeout: 30000 });
    }

    // Wait a bit for the component to fully render
    await this.page.waitForTimeout(3000);
  }

  /**
   * Get the docgenButton component within the test page
   */
  getDocgenButton() {
    return this.page.locator('c-docgen-button');
  }

  /**
   * Get the button element within the docgenButton component
   */
  getButton() {
    return this.page.locator('c-docgen-button button');
  }

  /**
   * Get the spinner element
   */
  getSpinner() {
    return this.page.locator('c-docgen-button lightning-spinner');
  }

  /**
   * Click the generate button
   */
  async clickGenerateButton() {
    const button = this.getButton();
    await button.waitFor({ state: 'visible', timeout: 10000 });
    await button.click();
  }

  /**
   * Wait for the button to be enabled
   */
  async waitForButtonEnabled() {
    const button = this.getButton();
    await button.waitFor({ state: 'visible', timeout: 10000 });
    await expect(button).toBeEnabled();
  }

  /**
   * Wait for the button to be disabled
   */
  async waitForButtonDisabled() {
    const button = this.getButton();
    await button.waitFor({ state: 'visible', timeout: 10000 });
    await expect(button).toBeDisabled();
  }

  /**
   * Wait for the spinner to be visible
   */
  async waitForSpinnerVisible() {
    const spinner = this.getSpinner();
    await spinner.waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Wait for the spinner to be hidden
   */
  async waitForSpinnerHidden() {
    const spinner = this.getSpinner();
    await spinner.waitFor({ state: 'hidden', timeout: 30000 });
  }

  /**
   * Wait for a toast message to appear
   * @param variant - The toast variant (success, error, warning, info)
   */
  async waitForToast(variant: 'success' | 'error' | 'warning' | 'info' = 'success') {
    const toastSelector = `lightning-toast[data-key="${variant}"]`;
    await this.page.waitForSelector(toastSelector, { state: 'visible', timeout: 15000 });
  }

  /**
   * Get the toast message text
   * @param variant - The toast variant
   */
  async getToastMessage(variant: 'success' | 'error' | 'warning' | 'info' = 'success'): Promise<string | null> {
    const toastSelector = `lightning-toast[data-key="${variant}"]`;
    const toast = this.page.locator(toastSelector);

    try {
      await toast.waitFor({ state: 'visible', timeout: 5000 });
      return await toast.textContent();
    } catch (error) {
      return null;
    }
  }

  /**
   * Get the Account details card
   */
  getAccountDetailsCard() {
    return this.page.locator('lightning-card:has-text("Account Details")').first();
  }

  /**
   * Get the Generated Documents card
   */
  getGeneratedDocumentsCard() {
    return this.page.locator('lightning-card:has-text("Generated Documents")');
  }

  /**
   * Get the datatable showing generated documents
   */
  getGeneratedDocumentsTable() {
    return this.page.locator('lightning-datatable');
  }

  /**
   * Wait for the account details to load
   */
  async waitForAccountDetailsLoaded() {
    // Simply wait for the docgen button to be visible since it's the main component we care about
    await this.page.waitForSelector('c-docgen-button', { state: 'visible', timeout: 15000 });

    // Optional: Wait for Account Details card if it exists
    try {
      const accountCard = this.getAccountDetailsCard();
      await accountCard.waitFor({ state: 'visible', timeout: 5000 });
    } catch (e) {
      // Account card might not be critical, continue
    }
  }

  /**
   * Get the account name displayed on the page
   */
  async getAccountName(): Promise<string | null> {
    // Try multiple possible selectors for the Name field
    const selectors = [
      'lightning-output-field[data-field-name="Name"]',
      'lightning-output-field[field-name="Name"]',
      '.slds-form-element:has-text("Name") lightning-formatted-text',
      'lightning-formatted-name'
    ];

    for (const selector of selectors) {
      try {
        const field = this.page.locator(selector).first();
        await field.waitFor({ state: 'visible', timeout: 2000 });
        return await field.textContent();
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  /**
   * Check if error message is displayed (for missing recordId)
   */
  async isErrorDisplayed(): Promise<boolean> {
    const errorDiv = this.page.locator('.slds-text-color_error');
    try {
      await errorDiv.waitFor({ state: 'visible', timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the error message text
   */
  async getErrorMessage(): Promise<string | null> {
    const errorDiv = this.page.locator('.slds-text-color_error');
    try {
      await errorDiv.waitFor({ state: 'visible', timeout: 3000 });
      return await errorDiv.textContent();
    } catch {
      return null;
    }
  }

  /**
   * Wait for the Generated Documents table to have at least one row
   */
  async waitForGeneratedDocumentsRow() {
    const table = this.getGeneratedDocumentsTable();
    await table.waitFor({ state: 'visible', timeout: 10000 });

    // Wait for at least one row
    await this.page.waitForSelector('lightning-datatable tbody tr',
      { state: 'visible', timeout: 10000 });
  }

  /**
   * Get the count of generated document rows in the table
   */
  async getGeneratedDocumentsCount(): Promise<number> {
    const rows = this.page.locator('lightning-datatable tbody tr');
    return await rows.count();
  }
}
