// ============================================================================
// Module: Azure Container Registry
// ============================================================================
// Creates Azure Container Registry for Docker image storage
//
// Dependencies: None
// Resources Created:
//   - Azure Container Registry (Basic SKU)
//   - Admin user disabled (use Managed Identity for access)
// ============================================================================

@description('Container Registry name (must be globally unique, alphanumeric only)')
param acrName string

@description('Azure region for resources')
param location string = resourceGroup().location

@description('SKU for Container Registry')
@allowed([
  'Basic'
  'Standard'
  'Premium'
])
param sku string = 'Basic'

@description('Common tags for all resources')
param tags object = {}

// ============================================================================
// Azure Container Registry
// ============================================================================

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-01-01-preview' = {
  name: acrName
  location: location
  tags: tags
  sku: {
    name: sku
  }
  properties: {
    adminUserEnabled: false // Use Managed Identity instead
    publicNetworkAccess: 'Enabled'
    zoneRedundancy: 'Disabled' // Cost optimization for Basic/Standard SKU
    policies: {
      retentionPolicy: {
        status: 'disabled'
      }
      trustPolicy: {
        status: 'disabled'
        type: 'Notary'
      }
    }
    encryption: {
      status: 'disabled'
    }
    dataEndpointEnabled: false
    networkRuleBypassOptions: 'AzureServices'
  }
}

// ============================================================================
// Outputs
// ============================================================================

@description('Container Registry resource ID')
output acrId string = containerRegistry.id

@description('Container Registry name')
output acrName string = containerRegistry.name

@description('Container Registry login server')
output acrLoginServer string = containerRegistry.properties.loginServer
