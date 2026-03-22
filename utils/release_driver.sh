#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

echo "Patching complete. Uploading to GitHub..."
PLAYWRIGHT_VERSION="${PLAYWRIGHT_VERSION:-${playwright_version:-}}"
VERSION_NUMBER="${PLAYWRIGHT_VERSION#v}"
RELEASE_DESCRIPTION="This is an automatic deployment in response to a new release of [microsoft/playwright](https://github.com/microsoft/playwright).\nThe original Release can be seen [here](https://github.com/microsoft/playwright/releases/tag/$PLAYWRIGHT_VERSION)."

# Step 1: Create a new GitHub release and get the upload URL
RELEASE_RESPONSE=$(curl -sSf --fail-with-body -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"tag_name\": \"$PLAYWRIGHT_VERSION\", \"name\": \"$PLAYWRIGHT_VERSION\", \"body\": \"$RELEASE_DESCRIPTION\", \"draft\": false, \"prerelease\": false}" \
  "https://api.github.com/repos/$REPO/releases")

echo "$RELEASE_RESPONSE"
# Extract the upload URL from the release response
UPLOAD_URL=$(jq -r '.upload_url // empty' <<<"$RELEASE_RESPONSE" | sed "s/{?name,label}//")

# Check if upload URL was extracted correctly
if [ -z "$UPLOAD_URL" ] || [ "$UPLOAD_URL" = "null" ]; then
    echo "Failed to create release. Upload URL missing in GitHub response." >&2
    exit 1
fi

# Step 2: Upload each .zip file in the directory as an asset
for zipFile in \
  "/playwright-$VERSION_NUMBER-mac.zip" \
  "/playwright-$VERSION_NUMBER-mac-arm64.zip" \
  "/playwright-$VERSION_NUMBER-linux.zip" \
  "/playwright-$VERSION_NUMBER-linux-arm64.zip" \
  "/playwright-$VERSION_NUMBER-win32_x64.zip" \
  "/playwright-$VERSION_NUMBER-win32_arm64.zip"; do
  fileName=$(basename "$zipFile")
  echo "Uploading $fileName..."

  curl -sSf --fail-with-body -X POST \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Content-Type: application/zip" \
    --data-binary @"./playwright/utils/build/output/$zipFile" \
    "$UPLOAD_URL?name=$fileName"
done

printf '\n\nRelease and assets uploaded successfully!\n'