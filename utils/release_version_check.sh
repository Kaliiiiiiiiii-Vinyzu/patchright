#!/bin/bash
set -euo pipefail

# Function to get the latest release version from a GitHub repository
get_latest_release() {
  local repo=$1
  local response
  if ! response=$(curl --fail --silent --show-error "https://api.github.com/repos/$repo/releases/latest"); then
    echo "Failed to fetch latest release for $repo" >&2
    echo "v0.0.0"
    return 0
  fi
  local version
  version=$(printf '%s\n' "$response" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/' || true)

  # Check if version is empty (meaning no releases found)
  if [ -z "$version" ]; then
    echo "Warning: could not parse latest release tag for $repo" >&2
    version="v0.0.0"
  fi

  echo "$version"
}

repo=${REPO:-${GITHUB_REPOSITORY:-}}
if [ -z "$repo" ]; then
  echo "Error: REPO or GITHUB_REPOSITORY must be set" >&2
  exit 1
fi

# Function to check whether a release tag exists in a repository's releases.
tag_exists_in_releases() {
  local repo=$1
  local tag=$2
  local response

  if ! response=$(curl --fail --silent --show-error "https://api.github.com/repos/$repo/releases?per_page=100"); then
    echo "Failed to fetch releases for $repo" >&2
    return 2
  fi

  # Treat "v1.2.3" and "1.2.3" as equivalent.
  local normalized_tag=${tag#v}
  while IFS= read -r release_tag; do
    local normalized_release_tag=${release_tag#v}
    if [ "$normalized_release_tag" = "$normalized_tag" ]; then
      return 0
    fi
  done < <(printf '%s\n' "$response" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/' || true)

  return 1
}

# Get the latest release version of microsoft/playwright
playwright_version=$(get_latest_release "microsoft/playwright")
echo "Latest release of the Playwright Driver: $playwright_version"

# Get the latest release version of Patchright
patchright_version=$(get_latest_release "$repo")
echo "Latest release of the Patchright Driver: $patchright_version"
echo "previous_playwright_version=$patchright_version" >>"$GITHUB_OUTPUT"

if [ "$playwright_version" = "v0.0.0" ] || [ "$patchright_version" = "v0.0.0" ]; then
  echo "GitHub API is unavailable; stopping the release version check." >&2
  echo "proceed=false" >>"$GITHUB_OUTPUT"
  echo "playwright_version=$playwright_version" >>"$GITHUB_OUTPUT"
  echo "playwright_version=$playwright_version" >>"$GITHUB_ENV"
  exit 0
fi

# Compare by existence: proceed only if Patchright does not contain the latest Playwright release tag.
if tag_exists_in_releases "$repo" "$playwright_version"; then
  echo "$repo is up to date with microsoft/playwright."
  echo "proceed=false" >>"$GITHUB_OUTPUT"
  echo "playwright_version=$playwright_version" >>"$GITHUB_OUTPUT"
else
  tag_status=$?
  if [ "$tag_status" -eq 2 ]; then
    echo "GitHub API is unavailable while checking existing releases; stopping the release version check." >&2
    echo "proceed=false" >>"$GITHUB_OUTPUT"
    echo "playwright_version=$playwright_version" >>"$GITHUB_OUTPUT"
    echo "playwright_version=$playwright_version" >>"$GITHUB_ENV"
  else
    echo "$repo is behind microsoft/playwright. Building & Patching..."
    echo "proceed=true" >>"$GITHUB_OUTPUT"
    echo "playwright_version=$playwright_version" >>"$GITHUB_OUTPUT"
    echo "playwright_version=$playwright_version" >>"$GITHUB_ENV"
  fi
fi
