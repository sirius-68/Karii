# Desktop build of the audio core tests and the speech-timing test (CI and local).
cmake_minimum_required(VERSION 3.22)
project(lectern_tests C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()
set(CPP ${CMAKE_CURRENT_SOURCE_DIR}/../cpp)
find_package(Threads REQUIRED)

add_executable(engine_test engine_test.cpp ${CPP}/core.cpp)
target_include_directories(engine_test PRIVATE ${CPP})
target_link_libraries(engine_test Threads::Threads)
