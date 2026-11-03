cmake_minimum_required(VERSION 3.22.1)
project(lectern C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

find_package(oboe REQUIRED CONFIG)

# whisper.cpp (speech recognition for AI lyric sync), built from source as static libraries.
include(FetchContent)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(WHISPER_CURL OFF CACHE BOOL "" FORCE)
set(WHISPER_SDL2 OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)
if(DEFINED ENV{WHISPER_SRC})
  FetchContent_Declare(whisper SOURCE_DIR $ENV{WHISPER_SRC})
else()
  FetchContent_Declare(whisper
    GIT_REPOSITORY https://github.com/ggml-org/whisper.cpp.git
    GIT_TAG v1.8.2
    GIT_SHALLOW TRUE)
endif()
FetchContent_MakeAvailable(whisper)

add_library(lectern SHARED core.cpp engine.cpp jni.cpp transcribe.cpp stt.cpp)
target_compile_options(lectern PRIVATE -O3 -ffast-math -Wall)
target_link_libraries(lectern oboe::oboe whisper log android)
