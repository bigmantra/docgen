#!/bin/bash
set -e

# Configure CI Backend for Local E2E Testing
# This script updates the CI backend's Key Vault with the local scratch org's credentials
# so that local e2e tests can successfully interact with the backend.

echo "════════════════════════════════════════════════════════════════"
echo "  Configure CI Backend for Local E2E Testing"
echo "════════════════════════════════════════════════════════════════"
echo ""

# Configuration
KEY_VAULT_NAME="docgen-ci-kv"
RESOURCE_GROUP="docgen-ci-rg"
CONTAINER_APP_NAME="docgen-ci"
BACKEND_URL="https://docgen-ci.bravemeadow-58840dba.eastus.azurecontainerapps.io"
MAX_HEALTH_CHECKS=30
HEALTH_CHECK_INTERVAL=4

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper function for colored output
error() {
    echo -e "${RED}❌ $1${NC}" >&2
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

info() {
    echo -e "${YELLOW}ℹ️  $1${NC}"
}

# Check prerequisites
echo "Step 1: Checking prerequisites..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    error "Azure CLI is not installed. Please install it first:"
    error "  https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
    exit 1
fi
success "Azure CLI found"

# Check if Salesforce CLI is installed
if ! command -v sf &> /dev/null; then
    error "Salesforce CLI is not installed. Please install it first:"
    error "  npm install -g @salesforce/cli"
    exit 1
fi
success "Salesforce CLI found"

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    error "jq is not installed. Please install it first:"
    error "  macOS: brew install jq"
    error "  Linux: apt-get install jq"
    exit 1
fi
success "jq found"

# Check Azure authentication
if ! az account show &> /dev/null; then
    error "Not authenticated to Azure. Please run: az login"
    exit 1
fi
AZURE_ACCOUNT=$(az account show --query "name" -o tsv)
success "Authenticated to Azure: $AZURE_ACCOUNT"

# Check if default Salesforce org exists
if ! sf org display --json &> /dev/null; then
    error "No default Salesforce org found. Please create a scratch org first:"
    error "  ./scripts/setup-scratch-org.sh"
    exit 1
fi
SF_ORG=$(sf org display --json | jq -r '.result.username')
success "Default Salesforce org: $SF_ORG"

echo ""
echo "Step 2: Extracting scratch org credentials..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Get SFDX Auth URL from the current default org using --verbose
# Extract the Sfdx Auth Url line and get the value after the │ separator
SFDX_AUTH_URL=$(sf org display --verbose 2>&1 | grep "Sfdx Auth Url" | sed 's/.*│ Sfdx Auth Url.*│ \(.*\) │/\1/' | tr -d ' ')

if [ -z "$SFDX_AUTH_URL" ] || [ "$SFDX_AUTH_URL" = "null" ]; then
    error "Failed to extract SFDX Auth URL from org"
    error "Please ensure you have a default scratch org set up:"
    error "  sf org list"
    error "  sf org display --verbose"
    exit 1
fi

success "Extracted SFDX Auth URL for: $SF_ORG"
info "Auth URL prefix: ${SFDX_AUTH_URL:0:50}..."

echo ""
echo "Step 3: Updating Key Vault with scratch org credentials..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Update Key Vault secret
az keyvault secret set \
  --vault-name "$KEY_VAULT_NAME" \
  --name SFDX-AUTH-URL \
  --value "$SFDX_AUTH_URL" \
  --output none

if [ $? -ne 0 ]; then
    error "Failed to update Key Vault secret"
    exit 1
fi

success "Key Vault updated: $KEY_VAULT_NAME/SFDX-AUTH-URL"

echo ""
echo "Step 4: Restarting CI backend to load new credentials..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Deploy new revision to reload Key Vault secrets
# Note: Restarting a revision doesn't reload secrets from Key Vault.
# We must deploy a new revision to pick up updated secrets.
info "Deploying new revision to reload Key Vault secrets..."
info "This will take ~60-90 seconds..."

# Add a timestamp env var to force a new revision deployment
TIMESTAMP=$(date +%s)
az containerapp update \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --set-env-vars "SECRET_RELOAD_TIMESTAMP=$TIMESTAMP" \
  --output none

if [ $? -ne 0 ]; then
    error "Failed to deploy new revision"
    exit 1
fi

success "New revision deployment initiated"
info "Waiting for new revision to become active and healthy..."
sleep 30  # Give Azure time to provision the new revision

echo ""
echo "Step 5: Waiting for backend health check..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Wait for backend to become healthy
ATTEMPT=0
while [ $ATTEMPT -lt $MAX_HEALTH_CHECKS ]; do
    ATTEMPT=$((ATTEMPT + 1))

    # Get HTTP status code and response
    HTTP_CODE=$(curl -s -o /tmp/readyz-response.json -w "%{http_code}" "${BACKEND_URL}/readyz" 2>/dev/null || echo "000")

    if [ "$HTTP_CODE" = "200" ]; then
        # Verify JSON response shows ready: true
        if jq -e '.ready == true' /tmp/readyz-response.json > /dev/null 2>&1; then
            success "CI backend is healthy and ready!"

            # Show backend details (if available)
            if jq -e '.checks.salesforce.domain' /tmp/readyz-response.json > /dev/null 2>&1; then
                SF_DOMAIN=$(jq -r '.checks.salesforce.domain' /tmp/readyz-response.json)
                info "Backend Salesforce domain: $SF_DOMAIN"
            fi

            echo ""
            echo "════════════════════════════════════════════════════════════════"
            success "Configuration complete! You can now run e2e tests."
            echo "════════════════════════════════════════════════════════════════"
            echo ""
            echo "Run tests with: npm run test:e2e"
            echo ""

            rm -f /tmp/readyz-response.json
            exit 0
        else
            info "Attempt $ATTEMPT/$MAX_HEALTH_CHECKS: Backend returned 200 but not ready yet"
            jq '.' /tmp/readyz-response.json 2>/dev/null || echo "(could not parse response)"
        fi
    else
        info "Attempt $ATTEMPT/$MAX_HEALTH_CHECKS: Backend returned HTTP $HTTP_CODE (expected 200)"
    fi

    if [ $ATTEMPT -lt $MAX_HEALTH_CHECKS ]; then
        echo "   Retrying in ${HEALTH_CHECK_INTERVAL}s..."
        sleep $HEALTH_CHECK_INTERVAL
    fi
done

# Health check failed after max attempts
echo ""
error "CI backend failed health check after $MAX_HEALTH_CHECKS attempts ($(($MAX_HEALTH_CHECKS * $HEALTH_CHECK_INTERVAL))s)"
error "Last response:"
cat /tmp/readyz-response.json 2>/dev/null || echo "(no response captured)"
echo ""
error "Please check backend logs:"
echo "  az containerapp logs show --name $CONTAINER_APP_NAME --resource-group $RESOURCE_GROUP --tail 100"
echo ""

rm -f /tmp/readyz-response.json
exit 1
