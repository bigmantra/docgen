#!/bin/bash
# ============================================================================
# Configure CI Backend for Scratch Org
# ============================================================================
# This script updates the CI backend Key Vault secrets to point to a specific
# scratch org, enabling e2e tests with the real backend.
#
# Usage:
#   ./scripts/configure-ci-backend-for-scratch-org.sh [scratch-org-alias]
#
# Example:
#   ./scripts/configure-ci-backend-for-scratch-org.sh docgen-dev
#
# What it does:
#   1. Gets scratch org credentials via sf CLI
#   2. Updates SF-DOMAIN secret in CI Key Vault
#   3. Restarts Container App to pick up new secrets
#   4. Waits for backend to be ready
#
# Prerequisites:
#   - Azure CLI logged in: az login
#   - Salesforce CLI installed: npm install -g @salesforce/cli
#   - Scratch org created and authenticated
#   - CI backend provisioned: ./scripts/provision-ci-backend.sh
# ============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
RESOURCE_GROUP="docgen-ci-rg"
APP_NAME="docgen-ci"
KEY_VAULT_NAME="docgen-ci-kv"

# Get scratch org alias from command line argument
SCRATCH_ORG_ALIAS="${1}"

# ============================================================================
# Helper Functions
# ============================================================================

log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✅${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}❌${NC} $1"
}

check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check Azure CLI
    if ! command -v az &> /dev/null; then
        log_error "Azure CLI not found. Install from: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
        exit 1
    fi

    # Check Azure login
    if ! az account show &> /dev/null; then
        log_error "Not logged into Azure. Run: az login"
        exit 1
    fi

    # Check Salesforce CLI
    if ! command -v sf &> /dev/null; then
        log_error "Salesforce CLI not found. Install: npm install -g @salesforce/cli"
        exit 1
    fi

    # Check if scratch org alias provided
    if [ -z "$SCRATCH_ORG_ALIAS" ]; then
        log_error "Scratch org alias required"
        echo "Usage: $0 <scratch-org-alias>"
        echo "Example: $0 docgen-dev"
        exit 1
    fi

    # Check if CI backend exists
    if ! az containerapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" &> /dev/null; then
        log_error "CI backend not found. Provision it first:"
        echo "  ./scripts/provision-ci-backend.sh"
        exit 1
    fi

    log_success "Prerequisites checked"
}

get_scratch_org_info() {
    log_info "Getting scratch org information..."

    # Get org info from sf CLI
    ORG_INFO=$(sf org display --target-org "$SCRATCH_ORG_ALIAS" --json)

    # Check if command succeeded
    if [ $? -ne 0 ]; then
        log_error "Failed to get scratch org info for: $SCRATCH_ORG_ALIAS"
        log_info "Available orgs:"
        sf org list
        exit 1
    fi

    # Extract instance URL
    INSTANCE_URL=$(echo "$ORG_INFO" | jq -r '.result.instanceUrl')

    # Extract domain from instance URL (e.g., https://test-abc123.scratch.my.salesforce.com -> test-abc123.scratch.my.salesforce.com)
    SF_DOMAIN=$(echo "$INSTANCE_URL" | sed 's|https://||' | sed 's|http://||')

    log_success "Scratch org domain: $SF_DOMAIN"
}

update_key_vault_secret() {
    log_info "Updating SF-DOMAIN secret in Key Vault..."

    az keyvault secret set \
      --vault-name "$KEY_VAULT_NAME" \
      --name SF-DOMAIN \
      --value "$SF_DOMAIN" \
      --output none

    log_success "SF-DOMAIN secret updated"
}

restart_container_app() {
    log_info "Restarting Container App to pick up new secrets..."

    # Get current revision name
    CURRENT_REVISION=$(az containerapp revision list \
      --name "$APP_NAME" \
      --resource-group "$RESOURCE_GROUP" \
      --query '[0].name' -o tsv)

    log_info "Current revision: $CURRENT_REVISION"

    # Restart by updating the app (this creates a new revision)
    az containerapp update \
      --name "$APP_NAME" \
      --resource-group "$RESOURCE_GROUP" \
      --output none

    log_success "Container App restarted"
}

wait_for_ready() {
    log_info "Waiting for backend to be ready with new configuration..."

    # Get backend URL
    APP_FQDN=$(az containerapp show \
      --name "$APP_NAME" \
      --resource-group "$RESOURCE_GROUP" \
      --query properties.configuration.ingress.fqdn -o tsv)

    BACKEND_URL="https://${APP_FQDN}"

    # Wait for health check
    MAX_ATTEMPTS=30
    ATTEMPT=0

    while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
        if curl -f -s "${BACKEND_URL}/healthz" > /dev/null 2>&1; then
            log_success "Backend is healthy!"

            # Check readiness (includes Key Vault connectivity)
            RESPONSE=$(curl -s "${BACKEND_URL}/readyz")
            if echo "$RESPONSE" | jq -e '.ready == true' > /dev/null 2>&1; then
                log_success "Backend is ready with new scratch org configuration!"

                # Verify Key Vault secrets are accessible
                KEYVAULT_STATUS=$(echo "$RESPONSE" | jq -r '.keyVault.status')
                if [ "$KEYVAULT_STATUS" = "healthy" ]; then
                    log_success "Key Vault connectivity verified"
                fi

                # Save backend URL for tests
                echo "$BACKEND_URL" > .ci-backend-url

                return 0
            else
                log_warning "Backend not fully ready yet (attempt $ATTEMPT/$MAX_ATTEMPTS)"
            fi
        fi

        ATTEMPT=$((ATTEMPT + 1))
        sleep 10
    done

    log_error "Backend failed to become ready after $MAX_ATTEMPTS attempts"
    exit 1
}

print_summary() {
    BACKEND_URL=$(cat .ci-backend-url)

    echo ""
    echo "========================================================================"
    echo "CI Backend Configured for Scratch Org"
    echo "========================================================================"
    echo ""
    echo "Scratch Org: $SCRATCH_ORG_ALIAS"
    echo "SF Domain: $SF_DOMAIN"
    echo "Backend URL: $BACKEND_URL"
    echo ""
    echo "Next Steps:"
    echo "  1. Configure External Credential in scratch org:"
    echo "     CLIENT_ID='<AAD_CLIENT_ID>'"
    echo "     CLIENT_SECRET='<AAD_CLIENT_SECRET>'"
    echo "     sed \"s/{{CLIENT_ID}}/\${CLIENT_ID}/g; s/{{CLIENT_SECRET}}/\${CLIENT_SECRET}/g\" \\"
    echo "       scripts/ConfigureExternalCredential.apex > /tmp/configure-cred.apex"
    echo "     sf apex run --file /tmp/configure-cred.apex --target-org $SCRATCH_ORG_ALIAS"
    echo ""
    echo "  2. Run E2E tests with real backend:"
    echo "     export TEST_MODE_DISABLED=true"
    echo "     export BACKEND_URL=$BACKEND_URL"
    echo "     export SF_USERNAME=<scratch-org-username>"
    echo "     npm run test:e2e"
    echo ""
    echo "========================================================================"
}

# ============================================================================
# Main Script
# ============================================================================

main() {
    echo ""
    echo "========================================================================"
    echo "Configuring CI Backend for Scratch Org: $SCRATCH_ORG_ALIAS"
    echo "========================================================================"
    echo ""

    check_prerequisites
    get_scratch_org_info
    update_key_vault_secret
    restart_container_app
    wait_for_ready
    print_summary
}

main "$@"
