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

# Function to compare two semantic versions (ignoring 'v' prefix)
version_is_behind() {
  local version1=${1//v/} # Remove 'v' prefix from version1
  local version2=${2//v/} # Remove 'v' prefix from version2

  IFS='.' read ver1_1 ver1_2 ver1_3 <<< "$version1"
  IFS='.' read ver2_1 ver2_2 ver2_3 <<< "$version2"

  ver1_1=${ver1_1:-0}
  ver1_2=${ver1_2:-0}
  ver1_3=${ver1_3:-0}
  ver2_1=${ver2_1:-0}
  ver2_2=${ver2_2:-0}
  ver2_3=${ver2_3:-0}

  if ((10#$ver1_1 < 10#$ver2_1)) || ((10#$ver1_1 == 10#$ver2_1 && 10#$ver1_2 < 10#$ver2_2)) || ((10#$ver1_1 == 10#$ver2_1 && 10#$ver1_2 == 10#$ver2_2 && 10#$ver1_3 < 10#$ver2_3)); then
    return 0
  fi

  return 1
}

# Get the latest release version of microsoft/playwright
playwright_version=$(get_latest_release "microsoft/playwright")
echo "Latest release of the Playwright Driver: $playwright_version"

# Get the latest release version of Patchright
patchright_version=$(get_latest_release "$repo")
echo "Latest release of the Patchright Driver: $patchright_version"
echo "previous_playwright_version=$patchright_version" >>"$GITHUB_OUTPUT"

# Compare the versions
if version_is_behind "$patchright_version" "$playwright_version"; then
  echo "$repo is behind microsoft/playwright. Building & Patching..."
  echo "proceed=true" >>"$GITHUB_OUTPUT"
  echo "playwright_version=$playwright_version" >>"$GITHUB_OUTPUT"
  echo "playwright_version=$playwright_version" >>"$GITHUB_ENV"
else
  echo "$repo is up to date with microsoft/playwright."
  echo "proceed=false" >>"$GITHUB_OUTPUT"
  echo "playwright_version=$playwright_version" >>"$GITHUB_OUTPUT"
fi
