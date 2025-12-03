#!/bin/bash
# Instrument eShopOnWeb Azure App Services with Datadog
# Requires: datadog-ci tool (npm install -g @datadog/datadog-ci)
set -e

# Configuration
DD_ENV="${DD_ENV:-dd-eshoponweb}"
DD_VERSION="${DD_VERSION:-1.0}"
DD_SUBSCRIPTION_ID="${DD_SUBSCRIPTION_ID:-8d2caa4b-9924-4670-9316-006ef551ccfe}"
LOG_PATH="${DD_LOG_PATH:-/home/LogFiles/app*.log}"
ENV_NAME="${AZURE_ENV_NAME:-}"

echo "Datadog Instrumentation for eShopOnWeb"
echo ""

# Check if datadog-ci is installed
if ! command -v datadog-ci &> /dev/null; then
    echo "ERROR: datadog-ci tool not found"
    echo "Install: npm install -g @datadog/datadog-ci"
    exit 1
fi

# Always query Azure for fresh resources (ignore cached env vars)
echo "Querying Azure for active resources..."

# Search for active resource group with web apps
if [ -n "$ENV_NAME" ]; then
    DISCOVERED_RG=$(az group list --tag azd-env-name="$ENV_NAME" --query "[0].name" -o tsv 2>/dev/null)
fi

# If no specific ENV_NAME, find resource groups with deployed apps
if [ -z "$DISCOVERED_RG" ]; then
    echo "Searching for deployed eShop applications..."
    
    # Get all rg-eshop* resource groups
    RG_CANDIDATES=$(az group list --query "[?starts_with(name, 'rg-eshop')].name" -o tsv 2>/dev/null)
    
    # Find one that has web apps
    for rg in $RG_CANDIDATES; do
        WEB_COUNT=$(az webapp list --resource-group "$rg" --query "length([?contains(name, 'web') || contains(name, 'api')])" -o tsv 2>/dev/null)
        if [ "$WEB_COUNT" -gt 0 ]; then
            DISCOVERED_RG="$rg"
            echo "Found deployment in: $rg"
            break
        fi
    done
fi

if [ -z "$DISCOVERED_RG" ]; then
    echo ""
    echo "ERROR: No deployed eShop application found"
    echo ""
    echo "Resource groups found:"
    az group list --query "[?starts_with(name, 'rg-eshop')].name" -o tsv || echo "  (none)"
    echo ""
    echo "Deploy application first: ./scripts/deploy-container.sh"
    exit 1
fi

RG_NAME="$DISCOVERED_RG"
echo ""

# Always query Azure for web apps
WEB_APP_NAME=$(az webapp list --resource-group "$RG_NAME" --query "[?contains(name, 'web') && !contains(name, 'api')].name | [0]" -o tsv 2>/dev/null)
PUBLIC_API_NAME=$(az webapp list --resource-group "$RG_NAME" --query "[?contains(name, 'api')].name | [0]" -o tsv 2>/dev/null)

# Verify we found the apps
if [ -z "$WEB_APP_NAME" ] || [ -z "$PUBLIC_API_NAME" ]; then
    echo "ERROR: Could not find both web app and API in resource group: $RG_NAME"
    echo ""
    echo "Available web apps:"
    az webapp list --resource-group "$RG_NAME" --query "[].name" -o tsv || echo "  (none found)"
    echo ""
    exit 1
fi

echo "Resource Group: $RG_NAME"
echo "Web App: $WEB_APP_NAME"
echo "Public API: $PUBLIC_API_NAME"
echo "Environment: $DD_ENV"
echo "Version: $DD_VERSION"
echo ""

# Instrument Web App
echo "Instrumenting web-app service..."
datadog-ci aas instrument \
  --dotnet \
  --service web-app \
  --env "$DD_ENV" \
  --log-path "$LOG_PATH" \
  -e DD_SOURCE=csharp \
  -e DD_REMOTE_CONFIGURATION_ENABLED=true \
  --version "$DD_VERSION" \
  -s "$DD_SUBSCRIPTION_ID" \
  -g "$RG_NAME" \
  -n "$WEB_APP_NAME"

echo "Web app instrumented"
echo ""

# Instrument Public API
echo "Instrumenting public-api service..."
datadog-ci aas instrument \
  --dotnet \
  --service public-api \
  --env "$DD_ENV" \
  --log-path "$LOG_PATH" \
  -e DD_SOURCE=csharp \
  -e DD_REMOTE_CONFIGURATION_ENABLED=true \
  --version "$DD_VERSION" \
  -s "$DD_SUBSCRIPTION_ID" \
  -g "$RG_NAME" \
  -n "$PUBLIC_API_NAME"

echo "Public API instrumented"
echo ""
echo "Done. View in Datadog:"
echo "  Environment: $DD_ENV"
echo "  Services: web-app, public-api"

