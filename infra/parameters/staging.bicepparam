// ============================================================================
// Bicep Parameters File: Staging Environment
// ============================================================================
// Parameter values for deploying to the staging environment (POC-EA subscription)
//
// Usage:
//   az deployment group create \
//     --resource-group docgen-staging-rg \
//     --template-file infra/main.bicep \
//     --parameters infra/parameters/staging.bicepparam
// ============================================================================

using '../main.bicep'

// ============================================================================
// Environment Configuration
// ============================================================================

param environment = 'staging'
param location = 'eastus'
param appName = 'docgen-staging'

// ============================================================================
// Azure Resource Names
// ============================================================================

param acrName = 'docgenstaging'
param keyVaultName = 'docgen-staging-kv'

// ============================================================================
// Azure AD Configuration
// ============================================================================

// Replace with your actual tenant ID and client ID
param tenantId = 'd8353d2a-b153-4d17-8827-902c51f72357'
param clientId = 'f42d24be-0a17-4a87-bfc5-d6cd84339302'

// ============================================================================
// SKU Configuration
// ============================================================================

param acrSku = 'Basic'
param keyVaultSku = 'standard'

// ============================================================================
// Application Configuration
// ============================================================================

param imageTag = 'latest'
param imageAllowlist = ''

// ============================================================================
// Tags
// ============================================================================

param tags = {
  Environment: 'staging'
  Project: 'Salesforce-Docgen'
  ManagedBy: 'Bicep'
  CostCenter: 'POC-EA'
}
