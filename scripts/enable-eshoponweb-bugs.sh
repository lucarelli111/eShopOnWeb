#!/bin/bash
# Configure performance issue simulation for eShopOnWeb
set -e

# Configuration
ENABLE_SLOW_BASKET="${ENABLE_SLOW_BASKET:-true}"
ENV_NAME="${AZURE_ENV_NAME:-}"

echo "Performance Configuration for eShopOnWeb"
echo ""

# Always query Azure for fresh resofalses
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

# Always query Azure for web app
WEB_APP_NAME=$(az webapp list --resource-group "$RG_NAME" --query "[?contains(name, 'web') && !contains(name, 'api')].name | [0]" -o tsv 2>/dev/null)

# Verify we found the web app
if [ -z "$WEB_APP_NAME" ]; then
    echo "ERROR: Could not find web app in resource group: $RG_NAME"
    echo ""
    echo "Available web apps:"
    az webapp list --resource-group "$RG_NAME" --query "[].name" -o tsv || echo "  (none found)"
    echo ""
    exit 1
fi

echo "Resource Group: $RG_NAME"
echo "Web App: $WEB_APP_NAME"
echo ""
echo "Settings:"
echo "  ENABLE_SLOW_BASKET: $ENABLE_SLOW_BASKET"
echo ""

# Configure Web App only
echo "Configuring $WEB_APP_NAME..."
az webapp config appsettings set \
  --name "$WEB_APP_NAME" \
  --resource-group "$RG_NAME" \
  --settings \
    ENABLE_SLOW_BASKET="$ENABLE_SLOW_BASKET" \
    DEBUG="true" \
  --output none

echo "Web app configured"
echo ""
echo "Done. App will restart automatically to apply settings."
echo ""
echo "To disable:"
echo "  ENABLE_SLOW_BASKET=false $0"

