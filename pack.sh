#!/bin/sh
# Build the zip to upload to https://extensions.gnome.org/upload/
set -e
cd "$(dirname "$0")"
gnome-extensions pack --force --extra-source=LICENSE .
echo "Built: $(ls ./*.shell-extension.zip)"
