#!/usr/bin/env bash

set -o errexit
set -o pipefail

LATEST_VERSION=$(node -p -e "require('./package.json').version")

if [ "$1" = "stdout" ]; then
    git-cliff --output - --unreleased --tag $LATEST_VERSION
else
    git-cliff --output './CHANGELOG.md' --tag $LATEST_VERSION
fi
