#!/bin/bash
# ============================================================================
# Grant RBAC Permissions to Container App Managed Identity
# ============================================================================
# This script manually grants the required permissions that couldn't be
# created via Bicep due to service principal permission limitations.
#
# Usage:
#   ./scripts/grant-container-app-permissions.sh
#
# Prerequisites:
#   - Run as a user with "Owner" or "User Access Administrator" role
#   - Container App must already be deployed
# ============================================================================

set -e

# Configuration
RESOURCE_GROUP="docgen-ci-rg"
CONTAINER_APP_NAME="docgen-ci"
ACR_NAME="docgenstaging"
ACR_RG="docgen-staging-rg"
KEY_VAULT_NAME="docgen-ci-kv"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}Getting Container App Managed Identity...${NC}"
PRINCIPAL_ID=$(az containerapp show \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "identity.principalId" \
  -o tsv)

echo "Container App Principal ID: $PRINCIPAL_ID"
echo ""

echo -e "${BLUE}Granting AcrPull role on Container Registry...${NC}"
az role assignment create \
  --assignee-object-id "$PRINCIPAL_ID" \
  --assignee-principal-type "ServicePrincipal" \
  --role "AcrPull" \
  --scope "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$ACR_RG/providers/Microsoft.ContainerRegistry/registries/$ACR_NAME"

echo -e "${GREEN}✓ AcrPull role granted${NC}"
echo ""

echo -e "${BLUE}Granting Key Vault Secrets User role on Key Vault...${NC}"
az role assignment create \
  --assignee-object-id "$PRINCIPAL_ID" \
  --assignee-principal-type "ServicePrincipal" \
  --role "Key Vault Secrets User" \
  --scope "/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.KeyVault/vaults/$KEY_VAULT_NAME"

echo -e "${GREEN}✓ Key Vault Secrets User role granted${NC}"
echo ""

echo -e "${GREEN}All permissions granted successfully!${NC}"
echo ""
echo "Next steps:"
echo "1. Restart Container App to pick up new permissions"
echo "2. Verify app starts successfully: az containerapp revision list --name $CONTAINER_APP_NAME --resource-group $RESOURCE_GROUP"
