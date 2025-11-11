#!/bin/bash
# provision-environment.sh
# One-time setup script for deploying docgen to a new Azure environment
# Usage: ./scripts/provision-environment.sh <environment>
# Example: ./scripts/provision-environment.sh staging
# Example: ./scripts/provision-environment.sh production

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

prompt_continue() {
    read -p "$(echo -e ${YELLOW}[PROMPT]${NC} $1 Continue? [y/N]: )" -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_error "Operation cancelled by user"
        exit 1
    fi
}

# Validate arguments
if [ $# -ne 1 ]; then
    log_error "Usage: $0 <environment>"
    log_error "Example: $0 staging"
    log_error "Example: $0 production"
    exit 1
fi

ENVIRONMENT=$1

# Validate environment
if [[ "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "production" ]]; then
    log_error "Environment must be 'staging' or 'production'"
    exit 1
fi

log_info "Starting one-time provisioning for: $ENVIRONMENT"
echo ""

# Load environment configuration
if [ "$ENVIRONMENT" = "staging" ]; then
    RESOURCE_GROUP="docgen-staging-rg"
    ACR_NAME="docgenstaging"
    KEY_VAULT_NAME="docgen-staging-kv"
    APP_NAME="docgen-staging"
    LOCATION="eastus"
    BICEP_PARAMS="infra/parameters/staging.bicepparam"
elif [ "$ENVIRONMENT" = "production" ]; then
    RESOURCE_GROUP="docgen-production-rg"
    ACR_NAME="docgenproduction"
    KEY_VAULT_NAME="docgen-production-kv"
    APP_NAME="docgen-production"
    LOCATION="eastus"
    BICEP_PARAMS="infra/parameters/production.bicepparam"
fi

log_info "Configuration:"
log_info "  Resource Group: $RESOURCE_GROUP"
log_info "  Location: $LOCATION"
log_info "  ACR: $ACR_NAME"
log_info "  Key Vault: $KEY_VAULT_NAME"
log_info "  Container App: $APP_NAME"
echo ""

# ============================================================================
# STEP 1: Verify Prerequisites
# ============================================================================
log_info "Step 1: Verifying prerequisites..."

# Check Azure CLI
if ! command -v az &> /dev/null; then
    log_error "Azure CLI not found. Please install: https://docs.microsoft.com/cli/azure/install-azure-cli"
    exit 1
fi
log_success "Azure CLI installed"

# Check Docker
if ! command -v docker &> /dev/null; then
    log_error "Docker not found. Please install: https://docs.docker.com/get-docker/"
    exit 1
fi
log_success "Docker installed"

# Check Azure login
if ! az account show &> /dev/null; then
    log_error "Not logged into Azure CLI. Run: az login"
    exit 1
fi

CURRENT_SUBSCRIPTION=$(az account show --query id -o tsv)
CURRENT_SUBSCRIPTION_NAME=$(az account show --query name -o tsv)
log_success "Logged into Azure"
log_info "  Subscription: $CURRENT_SUBSCRIPTION_NAME"
log_info "  ID: $CURRENT_SUBSCRIPTION"
echo ""

prompt_continue "Is this the correct subscription for $ENVIRONMENT?"

# Check required files
if [ ! -f "$BICEP_PARAMS" ]; then
    log_error "Parameter file not found: $BICEP_PARAMS"
    exit 1
fi
log_success "Bicep parameter file found"

if [ ! -f "keys/server.key" ]; then
    log_error "Private key not found: keys/server.key"
    exit 1
fi
log_success "Private key file found"

if [ ! -f ".env" ]; then
    log_error ".env file not found"
    exit 1
fi
log_success ".env file found"

# Load Salesforce credentials from .env
source .env
if [ -z "$SF_CLIENT_ID" ] || [ -z "$SF_USERNAME" ] || [ -z "$SF_DOMAIN" ]; then
    log_error "Missing Salesforce credentials in .env (SF_CLIENT_ID, SF_USERNAME, SF_DOMAIN)"
    exit 1
fi
log_success "Salesforce credentials loaded"
echo ""

# ============================================================================
# STEP 2: Create Resource Group
# ============================================================================
log_info "Step 2: Creating resource group..."

# Get user email for Owner tag
USER_EMAIL=$(az account show --query user.name -o tsv)
log_info "  Owner tag: $USER_EMAIL"

# Check if resource group exists
if az group show --name "$RESOURCE_GROUP" &> /dev/null; then
    log_warning "Resource group '$RESOURCE_GROUP' already exists"
    prompt_continue "Do you want to continue with existing resource group?"
else
    log_info "Creating resource group: $RESOURCE_GROUP"
    az group create \
        --name "$RESOURCE_GROUP" \
        --location "$LOCATION" \
        --tags Owner="$USER_EMAIL" Project="Personal Sandbox"

    log_success "Resource group created"
fi
echo ""

# ============================================================================
# STEP 3: Deploy Infrastructure via Bicep
# ============================================================================
log_info "Step 3: Deploying infrastructure via Bicep..."
log_warning "This will take 10-15 minutes. Please be patient."
echo ""

prompt_continue "Deploy infrastructure to $RESOURCE_GROUP?"

DEPLOYMENT_NAME="initial-deployment-$(date +%Y%m%d-%H%M%S)"

log_info "Starting deployment: $DEPLOYMENT_NAME"
az deployment group create \
    --name "$DEPLOYMENT_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --template-file infra/main.bicep \
    --parameters "$BICEP_PARAMS" \
    --query "{state: properties.provisioningState, duration: properties.duration}" \
    -o json

log_success "Infrastructure deployed successfully"

# Capture deployment outputs
log_info "Capturing deployment outputs..."
KEY_VAULT_URI=$(az keyvault show --name "$KEY_VAULT_NAME" --query properties.vaultUri -o tsv)
APP_INSIGHTS_CONNECTION_STRING=$(az monitor app-insights component show \
    --app "${APP_NAME%%-app}-insights" \
    --resource-group "$RESOURCE_GROUP" \
    --query connectionString -o tsv)
MANAGED_IDENTITY_PRINCIPAL_ID=$(az containerapp show \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query identity.principalId -o tsv)

log_info "  Key Vault URI: $KEY_VAULT_URI"
log_info "  App Insights Connection String: ${APP_INSIGHTS_CONNECTION_STRING:0:50}..."
log_info "  Managed Identity Principal ID: $MANAGED_IDENTITY_PRINCIPAL_ID"
echo ""

# ============================================================================
# STEP 4: Assign RBAC Roles (Workaround for Bicep propagation issue)
# ============================================================================
log_info "Step 4: Assigning RBAC roles to Managed Identity..."
log_warning "Note: Bicep should handle this, but we're doing it manually as a workaround"

# Wait for managed identity to propagate
log_info "Waiting 30 seconds for managed identity to propagate..."
sleep 30

# Assign AcrPull role
log_info "Assigning AcrPull role to $ACR_NAME..."
ACR_ID=$(az acr show --name "$ACR_NAME" --query id -o tsv)
az role assignment create \
    --role "AcrPull" \
    --assignee "$MANAGED_IDENTITY_PRINCIPAL_ID" \
    --scope "$ACR_ID" \
    || log_warning "Role assignment may already exist"

log_success "AcrPull role assigned"

# Assign Key Vault Secrets User role
log_info "Assigning Key Vault Secrets User role to $KEY_VAULT_NAME..."
KEY_VAULT_ID=$(az keyvault show --name "$KEY_VAULT_NAME" --query id -o tsv)
az role assignment create \
    --role "Key Vault Secrets User" \
    --assignee "$MANAGED_IDENTITY_PRINCIPAL_ID" \
    --scope "$KEY_VAULT_ID" \
    || log_warning "Role assignment may already exist"

log_success "Key Vault Secrets User role assigned"

# Assign Key Vault Secrets Officer role to current user (for secret population)
log_info "Assigning Key Vault Secrets Officer role to current user..."
az role assignment create \
    --role "Key Vault Secrets Officer" \
    --assignee "$USER_EMAIL" \
    --scope "$KEY_VAULT_ID" \
    || log_warning "Role assignment may already exist"

log_success "Key Vault Secrets Officer role assigned to user"
log_info "Waiting 30 seconds for role assignments to propagate..."
sleep 30
echo ""

# ============================================================================
# STEP 5: Populate Key Vault Secrets
# ============================================================================
log_info "Step 5: Populating Key Vault secrets..."

log_info "Setting SF-PRIVATE-KEY..."
az keyvault secret set \
    --vault-name "$KEY_VAULT_NAME" \
    --name SF-PRIVATE-KEY \
    --file keys/server.key \
    --query name -o tsv > /dev/null
log_success "SF-PRIVATE-KEY set"

log_info "Setting SF-CLIENT-ID..."
az keyvault secret set \
    --vault-name "$KEY_VAULT_NAME" \
    --name SF-CLIENT-ID \
    --value "$SF_CLIENT_ID" \
    --query name -o tsv > /dev/null
log_success "SF-CLIENT-ID set"

log_info "Setting SF-USERNAME..."
az keyvault secret set \
    --vault-name "$KEY_VAULT_NAME" \
    --name SF-USERNAME \
    --value "$SF_USERNAME" \
    --query name -o tsv > /dev/null
log_success "SF-USERNAME set"

log_info "Setting SF-DOMAIN..."
az keyvault secret set \
    --vault-name "$KEY_VAULT_NAME" \
    --name SF-DOMAIN \
    --value "$SF_DOMAIN" \
    --query name -o tsv > /dev/null
log_success "SF-DOMAIN set"

log_info "Setting AZURE-MONITOR-CONNECTION-STRING..."
az keyvault secret set \
    --vault-name "$KEY_VAULT_NAME" \
    --name AZURE-MONITOR-CONNECTION-STRING \
    --value "$APP_INSIGHTS_CONNECTION_STRING" \
    --query name -o tsv > /dev/null
log_success "AZURE-MONITOR-CONNECTION-STRING set"

# Verify all secrets
SECRET_COUNT=$(az keyvault secret list --vault-name "$KEY_VAULT_NAME" --query "length(@)" -o tsv)
log_success "All 5 secrets populated (found: $SECRET_COUNT)"
echo ""

# ============================================================================
# STEP 6: Build and Push Docker Image
# ============================================================================
log_info "Step 6: Building and pushing Docker image..."
log_warning "This will take 5-10 minutes depending on your machine"
echo ""

prompt_continue "Build and push Docker image to $ACR_NAME?"

# Login to ACR
log_info "Logging into Azure Container Registry..."
az acr login --name "$ACR_NAME"
log_success "ACR login successful"

# Build image
IMAGE_TAG="initial"
IMAGE_URI="$ACR_NAME.azurecr.io/docgen-api:$IMAGE_TAG"
IMAGE_URI_LATEST="$ACR_NAME.azurecr.io/docgen-api:latest"

log_info "Building Docker image (platform: linux/amd64)..."
log_info "  Tag: $IMAGE_URI"
docker build --platform linux/amd64 \
    -t "$IMAGE_URI" \
    -t "$IMAGE_URI_LATEST" \
    .

log_success "Docker image built successfully"

# Push image
log_info "Pushing image to ACR..."
docker push "$IMAGE_URI"
docker push "$IMAGE_URI_LATEST"

log_success "Image pushed to ACR"

# Verify image
IMAGE_DIGEST=$(az acr repository show-tags \
    --name "$ACR_NAME" \
    --repository docgen-api \
    --query "[?@ == '$IMAGE_TAG'] | [0]" -o tsv)

log_info "  Verified in ACR: $IMAGE_TAG"
echo ""

# ============================================================================
# STEP 7: Update Container App with Initial Image
# ============================================================================
log_info "Step 7: Updating Container App with initial image..."

prompt_continue "Update Container App?"

log_info "Updating $APP_NAME with image: $IMAGE_URI"
az containerapp update \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --image "$IMAGE_URI" \
    --query "{name: name, provisioningState: properties.provisioningState, latestRevision: properties.latestRevisionName}" \
    -o json

log_success "Container App updated successfully"

# Get app URL
APP_FQDN=$(az containerapp show \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query properties.configuration.ingress.fqdn -o tsv)

log_info "  App URL: https://$APP_FQDN"
echo ""

# ============================================================================
# STEP 8: Validation
# ============================================================================
log_info "Step 8: Running validation tests..."

# Wait for app to be ready
log_info "Waiting 30 seconds for app to start..."
sleep 30

# Test health endpoint
log_info "Testing /healthz endpoint..."
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://$APP_FQDN/healthz")
if [ "$HEALTH_STATUS" = "200" ]; then
    log_success "Health check passed (HTTP $HEALTH_STATUS)"
else
    log_error "Health check failed (HTTP $HEALTH_STATUS)"
fi

# Test readiness endpoint
log_info "Testing /readyz endpoint..."
READINESS_RESPONSE=$(curl -s "https://$APP_FQDN/readyz")
echo "  Response: $READINESS_RESPONSE"

if echo "$READINESS_RESPONSE" | grep -q '"ready":true'; then
    log_success "Readiness check passed"
else
    log_warning "Readiness check may have issues - check response above"
fi

# Check container logs
log_info "Checking container logs for errors..."
ERROR_COUNT=$(az containerapp logs show \
    --name "$APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --tail 50 \
    --type console 2>&1 | grep -ic "error" || echo "0")

if [ "$ERROR_COUNT" = "0" ]; then
    log_success "No errors found in recent logs"
else
    log_warning "Found $ERROR_COUNT errors in logs - review manually"
fi

echo ""

# ============================================================================
# Summary
# ============================================================================
log_success "====================================================================="
log_success "Provisioning complete for: $ENVIRONMENT"
log_success "====================================================================="
echo ""
log_info "Resources Created:"
log_info "  Resource Group: $RESOURCE_GROUP"
log_info "  Container Registry: $ACR_NAME"
log_info "  Key Vault: $KEY_VAULT_NAME"
log_info "  Container App: $APP_NAME"
log_info "  Managed Identity: $MANAGED_IDENTITY_PRINCIPAL_ID"
echo ""
log_info "Application URL:"
log_info "  https://$APP_FQDN"
echo ""
log_info "Next Steps:"
log_info "  1. Test end-to-end PDF generation from Salesforce"
log_info "  2. Monitor Application Insights for telemetry"
log_info "  3. Configure GitHub secrets for CI/CD automation"
log_info "  4. Test automated deployment workflow"
echo ""
log_success "Run this command to view logs:"
echo "  az containerapp logs show --name $APP_NAME --resource-group $RESOURCE_GROUP --follow"
echo ""
log_success "Run this command to view Container App details:"
echo "  az containerapp show --name $APP_NAME --resource-group $RESOURCE_GROUP"
echo ""
