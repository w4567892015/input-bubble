#!/bin/sh
# Build the zip attached to GitHub releases
set -e
cd "$(dirname "$0")"
gnome-extensions pack --force --extra-source=LICENSE .
echo "Built: $(ls ./*.shell-extension.zip)"
