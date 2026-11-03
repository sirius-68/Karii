#!/usr/bin/env bash
# Builds and runs the audio core tests on a desktop (Linux/macOS).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
c++ -std=c++17 -O2 -Wall -pthread -I../cpp ../cpp/core.cpp engine_test.cpp -o build/engine_test
./build/engine_test
