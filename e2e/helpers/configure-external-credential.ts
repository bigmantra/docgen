/**
 * Configure External Credential principal via Playwright UI automation.
 * Fallback when Apex ConnectApi execution fails.
 *
 * Usage:
 *   npx ts-node e2e/helpers/configure-external-credential.ts \
 *     --org-url "https://momentum-force-1234.scratch.my.salesforce.com" \
 *     --client-id "f42d24be-..." \
 *     --client-secret "abc123..."
 */

import { chromium, type Browser, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

interface ConfigureCredentialArgs {
  orgUrl: string;
  clientId: string;
  clientSecret: string;
  authUrl?: string; // Salesforce auth URL from sf org display
}

async function getSalesforceAuthFromFile(): Promise<{ accessToken: string; instanceUrl: string }> {
  // Read Salesforce auth from sfdx config
  const { execSync } = require('child_process');

  try {
    const result = execSync('sf org display --json', { encoding: 'utf-8' });
    const orgInfo = JSON.parse(result);

    if (orgInfo.status === 0 && orgInfo.result) {
      return {
        accessToken: orgInfo.result.accessToken,
        instanceUrl: orgInfo.result.instanceUrl,
      };
    }
  } catch (error) {
    console.error('Failed to get Salesforce auth from sf CLI:', error);
  }

  throw new Error('Could not retrieve Salesforce authentication');
}

async function configureExternalCredential(args: ConfigureCredentialArgs): Promise<void> {
  let browser: Browser | null = null;

  try {
    console.log('🔧 Starting Playwright-based External Credential configuration...');

    // Get Salesforce auth
    const auth = await getSalesforceAuthFromFile();
    console.log(`Using instance URL: ${auth.instanceUrl}`);

    // Launch browser
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      extraHTTPHeaders: {
        Authorization: `Bearer ${auth.accessToken}`,
      },
    });
    const page = await context.newPage();

    // Navigate to External Credentials setup page
    const setupUrl = `${auth.instanceUrl}/lightning/setup/NamedCredential/home`;
    console.log(`Navigating to: ${setupUrl}`);
    await page.goto(setupUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for setup page to load
    await page.waitForSelector('text=External Credentials', { timeout: 15000 });
    console.log('✅ Setup page loaded');

    // Search for our External Credential
    const searchBox = page.locator('input[placeholder*="Search"]').first();
    if (await searchBox.isVisible({ timeout: 5000 })) {
      await searchBox.fill('Docgen AAD Credential (CI)');
      await page.waitForTimeout(1000);
    }

    // Click on the External Credential
    const credentialLink = page.locator('text=Docgen AAD Credential (CI)').first();
    await credentialLink.click({ timeout: 10000 });
    console.log('✅ Opened External Credential');

    // Wait for credential detail page
    await page.waitForLoadState('networkidle');

    // Check if principal "CI" already exists
    const hasPrincipal = await page.locator('text=CI').count() > 0;

    if (hasPrincipal) {
      console.log('Principal "CI" exists, editing...');

      // Click edit button (look for button with title or aria-label)
      const editButton = page.locator('button[title*="Edit"]').first();
      await editButton.click({ timeout: 10000 });
    } else {
      console.log('Principal "CI" does not exist, creating new...');

      // Click "New" button to create principal
      const newButton = page.locator('button:has-text("New")').first();
      await newButton.click({ timeout: 10000 });

      // Fill in principal name
      const principalNameInput = page.locator('input[name*="principalName"], input[label*="Principal Name"]').first();
      await principalNameInput.fill('CI');
    }

    // Wait for edit form to load
    await page.waitForTimeout(2000);

    // Fill in Client ID
    console.log('Filling in Client ID...');
    const clientIdInput = page
      .locator('input[name*="ClientId"], input[label*="Client ID"], input[placeholder*="Client ID"]')
      .first();
    await clientIdInput.waitFor({ state: 'visible', timeout: 10000 });
    await clientIdInput.fill(args.clientId);
    console.log(`✅ Client ID set: ${args.clientId.substring(0, 8)}...`);

    // Fill in Client Secret
    console.log('Filling in Client Secret...');
    const clientSecretInput = page
      .locator('input[name*="ClientSecret"], input[label*="Client Secret"], input[placeholder*="Client Secret"]')
      .first();
    await clientSecretInput.waitFor({ state: 'visible', timeout: 10000 });
    await clientSecretInput.fill(args.clientSecret);
    console.log('✅ Client Secret set');

    // Click Save
    console.log('Saving configuration...');
    const saveButton = page.locator('button:has-text("Save")').first();
    await saveButton.click({ timeout: 10000 });

    // Wait for success message
    try {
      await page.waitForSelector('text="was saved", text="Success"', { timeout: 15000 });
      console.log('✅ External Credential configured successfully via Playwright');
    } catch (error) {
      // Take screenshot on failure
      const screenshotPath = path.join(__dirname, '..', 'playwright-report', 'external-cred-error.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.error(`❌ Did not see success message. Screenshot saved to: ${screenshotPath}`);
      throw new Error('Failed to verify successful save');
    }
  } catch (error) {
    console.error('❌ Failed to configure External Credential via Playwright:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// CLI entry point
async function main() {
  const args: ConfigureCredentialArgs = {
    orgUrl: '',
    clientId: '',
    clientSecret: '',
  };

  // Parse command line arguments
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--org-url=')) {
      args.orgUrl = arg.split('=')[1];
    } else if (arg.startsWith('--client-id=')) {
      args.clientId = arg.split('=')[1];
    } else if (arg.startsWith('--client-secret=')) {
      args.clientSecret = arg.split('=')[1];
    }
  }

  // Validate required arguments
  if (!args.clientId || !args.clientSecret) {
    console.error('❌ Missing required arguments');
    console.error('Usage: npx ts-node configure-external-credential.ts --client-id=<id> --client-secret=<secret>');
    process.exit(1);
  }

  try {
    await configureExternalCredential(args);
    process.exit(0);
  } catch (error) {
    console.error('Configuration failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { configureExternalCredential, type ConfigureCredentialArgs };
