#!/bin/bash

# Script to help set up GitHub secrets for staging deployment
# This script provides the exact values needed for GitHub Actions

set -e

echo "================================================"
echo "GitHub Secrets Setup for Staging Deployment"
echo "================================================"
echo ""
echo "You need to manually add these secrets to your GitHub repository."
echo "Go to: Settings → Secrets and variables → Actions → Environments → staging"
echo ""
echo "If the 'staging' environment doesn't exist, create it first."
echo ""
echo "================================================"
echo "REQUIRED SECRETS:"
echo "================================================"
echo ""

# Azure Subscription Info
SUBSCRIPTION_ID="e6890ad9-401e-4696-bee4-c50fe72aa287"
TENANT_ID="d8353d2a-b153-4d17-8827-902c51f72357"
CLIENT_ID="f42d24be-0a17-4a87-bfc5-d6cd84339302"
# CLIENT_SECRET should be obtained from azure-ad-config.md or Azure Portal
# Do not hardcode the secret in this script
CLIENT_SECRET="${AZURE_CLIENT_SECRET:-<GET_FROM_AZURE_AD_CONFIG>}"

# Create AZURE_CREDENTIALS JSON
AZURE_CREDENTIALS=$(cat <<EOF
{
  "clientId": "$CLIENT_ID",
  "clientSecret": "$CLIENT_SECRET",
  "subscriptionId": "$SUBSCRIPTION_ID",
  "tenantId": "$TENANT_ID"
}
EOF
)

echo "1. AZURE_CREDENTIALS"
if [[ "$CLIENT_SECRET" == "<GET_FROM_AZURE_AD_CONFIG>" ]]; then
    echo "   ⚠️  WARNING: You need to set the client secret!"
    echo "   Get it from azure-ad-config.md (line 14) or run:"
    echo "   export AZURE_CLIENT_SECRET='<your-client-secret>'"
    echo "   Then re-run this script"
else
    echo "   Value (copy everything between the lines):"
    echo "   ----------------------------------------"
    echo "$AZURE_CREDENTIALS"
    echo "   ----------------------------------------"
fi
echo ""

echo "2. AZURE_SUBSCRIPTION_ID"
echo "   Value: $SUBSCRIPTION_ID"
echo ""

echo "3. ACR_NAME"
echo "   Value: docgenstaging"
echo ""

echo "4. RESOURCE_GROUP"
echo "   Value: docgen-staging-rg"
echo ""

echo "5. APP_NAME"
echo "   Value: docgen-staging"
echo ""

echo "6. KEY_VAULT_NAME"
echo "   Value: docgen-staging-kv"
echo ""

echo "================================================"
echo "SALESFORCE SECRETS (from your .env file):"
echo "================================================"
echo ""
echo "You also need to add these Salesforce secrets:"
echo ""

# Try to read from .env if it exists
if [ -f ".env" ]; then
    echo "Reading from .env file..."
    source .env

    echo "7. SF_PRIVATE_KEY"
    if [ ! -z "$SF_PRIVATE_KEY" ]; then
        echo "   Value: (Found in .env - copy from there)"
        echo "   First line: $(echo "$SF_PRIVATE_KEY" | head -n 1)"
    else
        echo "   Value: (Not found in .env - add your Salesforce private key in PEM format)"
    fi
    echo ""

    echo "8. SF_CLIENT_ID"
    if [ ! -z "$SF_CLIENT_ID" ]; then
        echo "   Value: $SF_CLIENT_ID"
    else
        echo "   Value: (Not found in .env - add your Salesforce connected app client ID)"
    fi
    echo ""

    echo "9. SF_USERNAME"
    if [ ! -z "$SF_USERNAME" ]; then
        echo "   Value: $SF_USERNAME"
    else
        echo "   Value: (Not found in .env - add your Salesforce username)"
    fi
    echo ""

    echo "10. SF_DOMAIN"
    if [ ! -z "$SF_DOMAIN" ]; then
        echo "   Value: $SF_DOMAIN"
    else
        echo "   Value: (Not found in .env - add your Salesforce domain)"
    fi
else
    echo "No .env file found. Please add these manually:"
    echo ""
    echo "7. SF_PRIVATE_KEY"
    echo "   Value: Your Salesforce private key (full PEM format)"
    echo ""
    echo "8. SF_CLIENT_ID"
    echo "   Value: Your Salesforce connected app client ID"
    echo ""
    echo "9. SF_USERNAME"
    echo "   Value: Your Salesforce username"
    echo ""
    echo "10. SF_DOMAIN"
    echo "   Value: Your Salesforce domain (e.g., yourorg.my.salesforce.com)"
fi

echo ""
echo "================================================"
echo "NEXT STEPS:"
echo "================================================"
echo ""
echo "1. Go to: https://github.com/bigmantra/docgen/settings/environments"
echo "2. Create 'staging' environment if it doesn't exist"
echo "3. Add all the secrets listed above"
echo "4. Re-run the failed workflow or push a change to trigger deployment"
echo ""
echo "================================================"
echo "VERIFY SERVICE PRINCIPAL PERMISSIONS:"
echo "================================================"
echo ""

# Check if logged in to Azure
if az account show &>/dev/null; then
    echo "Checking service principal permissions..."

    # Check role assignments
    echo "Role assignments for the service principal:"
    az role assignment list \
        --assignee "$CLIENT_ID" \
        --all \
        --output table 2>/dev/null || echo "Could not list role assignments"

    echo ""
    echo "Note: The service principal needs 'Contributor' role on the resource group 'docgen-staging-rg'"
    echo ""

    # Check if we need to add the role
    ROLE_EXISTS=$(az role assignment list \
        --assignee "$CLIENT_ID" \
        --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/docgen-staging-rg" \
        --role "Contributor" \
        --query "[0].id" -o tsv 2>/dev/null)

    if [ -z "$ROLE_EXISTS" ]; then
        echo "WARNING: Service principal doesn't have Contributor role on docgen-staging-rg"
        echo ""
        echo "To fix this, run:"
        echo "az role assignment create \\"
        echo "  --assignee $CLIENT_ID \\"
        echo "  --role Contributor \\"
        echo "  --scope /subscriptions/$SUBSCRIPTION_ID/resourceGroups/docgen-staging-rg"
    else
        echo "✓ Service principal has Contributor role on docgen-staging-rg"
    fi
else
    echo "Not logged in to Azure. To verify permissions, run:"
    echo "az login"
    echo "Then re-run this script"
fi

echo ""
echo "================================================"
echo "Script complete!"
echo "================================================"