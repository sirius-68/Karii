# Compiler flags of the audio core, shared by the phone build (CMakeLists.txt) and the desktop
# tests (../test/CMakeLists.txt) so that a passing test means the same code works on a phone.
#
# -ffast-math alone lets the compiler assume a number is never "not a number" (NaN). The recorder
# marks "no music playing at this moment" with NaN; with that assumption the music track of
# every cleanly mixed take came out silent on phones while the tests (then built without the
# flag) passed. -fno-finite-math-only keeps NaN and infinity working.
set(LECTERN_CXX_FLAGS -O3 -ffast-math -fno-finite-math-only -Wall)
