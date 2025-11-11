// ============================================================================
// Module: Container Apps Environment
// ============================================================================
// Creates Azure Container Apps managed environment
//
// Dependencies:
//   - Log Analytics Workspace (for logs and monitoring)
// Resources Created:
//   - Container Apps Environment
//   - Zone redundancy disabled (cost optimization)
// ============================================================================

@description('Environment name (e.g., staging, production)')
param environment string

@description('Azure region for resources')
param location string = resourceGroup().location

@description('Log Analytics Workspace resource ID')
param workspaceId string

@description('Log Analytics Workspace customer ID')
param workspaceCustomerId string

@description('Common tags for all resources')
param tags object = {}

// ============================================================================
// Variables
// ============================================================================

var envName = 'docgen-${environment}-env'

// ============================================================================
// Container Apps Environment
// ============================================================================

resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: envName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: workspaceCustomerId
        sharedKey: listKeys(workspaceId, '2022-10-01').primarySharedKey
      }
    }
    zoneRedundant: false // Cost optimization for staging
    workloadProfiles: []
  }
}

// ============================================================================
// Outputs
// ============================================================================

@description('Container Apps Environment resource ID')
output environmentId string = containerAppsEnvironment.id

@description('Container Apps Environment name')
output environmentName string = containerAppsEnvironment.name

@description('Container Apps Environment default domain')
output environmentDefaultDomain string = containerAppsEnvironment.properties.defaultDomain
