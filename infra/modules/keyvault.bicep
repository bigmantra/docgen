// ============================================================================
// Module: Azure Key Vault
// ============================================================================
// Creates Azure Key Vault for secrets management with RBAC authorization
//
// Dependencies: None
// Resources Created:
//   - Azure Key Vault (Standard SKU)
//   - RBAC authorization enabled
//   - Soft delete and purge protection enabled
//   - Network access: Allow Azure services
// ============================================================================

@description('Key Vault name (must be globally unique, 3-24 chars, alphanumeric and hyphens)')
@minLength(3)
@maxLength(24)
param keyVaultName string

@description('Azure region for resources')
param location string = resourceGroup().location

@description('Azure AD tenant ID')
param tenantId string

@description('SKU for Key Vault')
@allowed([
  'standard'
  'premium'
])
param sku string = 'standard'

@description('Common tags for all resources')
param tags object = {}

// ============================================================================
// Azure Key Vault
// ============================================================================

resource keyVault 'Microsoft.KeyVault/vaults@2023-02-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    tenantId: tenantId
    sku: {
      family: 'A'
      name: sku
    }

    // Use Azure RBAC for authorization (not legacy access policies)
    enableRbacAuthorization: true

    // Soft delete and purge protection for production safety
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true

    // Network access
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices' // Allow Azure services (Container Apps, etc.)
      defaultAction: 'Allow'  // Can be changed to 'Deny' with specific IP rules if needed
      ipRules: []
      virtualNetworkRules: []
    }

    // Additional security settings
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: true // Allow ARM/Bicep deployments
  }
}

// ============================================================================
// Outputs
// ============================================================================

@description('Key Vault resource ID')
output keyVaultId string = keyVault.id

@description('Key Vault name')
output keyVaultName string = keyVault.name

@description('Key Vault URI')
output keyVaultUri string = keyVault.properties.vaultUri
