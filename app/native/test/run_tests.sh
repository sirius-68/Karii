#!/usr/bin/env bash
# Builds and runs the audio core tests on a desktop (Linux/macOS).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
# the same optimisation flags as the phone build (see native/cpp/CMakeLists.txt): a test that
# passes here must mean the same code works there
c++ -std=c++17 -O3 -ffast-math -fno-finite-math-only -Wall -pthread -I../cpp ../cpp/core.cpp engine_test.cpp -o build/engine_test
./build/engine_test
