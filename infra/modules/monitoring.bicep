// ============================================================================
// Module: Monitoring (Log Analytics + Application Insights)
// ============================================================================
// Creates Log Analytics Workspace and Application Insights for observability
//
// Dependencies: None
// Resources Created:
//   - Log Analytics Workspace (30-day retention)
//   - Application Insights (linked to workspace)
// ============================================================================

@description('Environment name (e.g., staging, production)')
param environment string

@description('Azure region for resources')
param location string = resourceGroup().location

@description('Common tags for all resources')
param tags object = {}

// ============================================================================
// Variables
// ============================================================================

var workspaceName = 'docgen-${environment}-logs'
var appInsightsName = 'docgen-${environment}-insights'

// ============================================================================
// Log Analytics Workspace
// ============================================================================

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: workspaceName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    workspaceCapping: {
      dailyQuotaGb: -1 // No cap by default
    }
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

// ============================================================================
// Application Insights
// ============================================================================

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    Flow_Type: 'Bluefield'
    Request_Source: 'rest'
    RetentionInDays: 30
    WorkspaceResourceId: logAnalyticsWorkspace.id
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

// ============================================================================
// Outputs
// ============================================================================

@description('Log Analytics Workspace resource ID')
output workspaceId string = logAnalyticsWorkspace.id

@description('Log Analytics Workspace customer ID')
output workspaceCustomerId string = logAnalyticsWorkspace.properties.customerId

@description('Log Analytics Workspace name')
output workspaceName string = logAnalyticsWorkspace.name

@description('Application Insights resource ID')
output appInsightsId string = applicationInsights.id

@description('Application Insights name')
output appInsightsName string = applicationInsights.name

@description('Application Insights instrumentation key')
output appInsightsInstrumentationKey string = applicationInsights.properties.InstrumentationKey

@description('Application Insights connection string')
output appInsightsConnectionString string = applicationInsights.properties.ConnectionString
