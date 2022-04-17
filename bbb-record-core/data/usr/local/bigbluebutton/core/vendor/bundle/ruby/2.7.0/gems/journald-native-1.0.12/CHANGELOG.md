# Changelog

## v1.0.12

*May 25, 2020*

* Updated tests for long function names
* Improvements in CI
* Pinned bundler to 2.x

## v1.0.11

*September 14, 2018*

* Introduce long function names
* Fix dummy building on FreeBSD [[#4]](https://github.com/sandfoxme/journald-native/issues/4)
* Fix print() dummy call crash on FreeBSD

## v1.0.10

*March 29, 2018*

* Make require calls rpm-friendly [[#3]](https://github.com/sandfoxme/journald-native/pull/3)
* Fix compilation problems on some systems due to CFLAGS being overwritten

## v1.0.9

*April 11, 2016*

* Change license to LGPL 2.1 or later to match systemd
* Change C version from C99 to C11
* Use safer xmalloc/xfree memory allocation functions from Ruby API
* Add tests

## v1.0.8

**1.0.8 was missed due to a technical error, sorry**

## v1.0.7

*July 28, 2015*

C extention updated to 1.0.6 features, released as 1.0.7

Returning to C due to overgrown complexity of C++ template wrapper code for Ruby exception handling

## v1.0.6

*March 10, 2015*

*  No longer accepts strings with zero byte as valid

## v1.0.5

*March 10, 2015*

* Dummy detection const & method
  ```ruby
  Journald::Native.dummy?    # true on linux,
  Journald::Native::IS_DUMMY # false otherwise
  ```

## v1.0.4

*March 09, 2015*

* Port extention from C to C++11
* Make everything memory and exception safe

## v1.0.3

*February 05, 2015*

* Dummy compilation on MacOS and Windows (dummy sd_journal_* calls that return 0 doing nothing)
* Link to libsystemd instead of libsystemd-journal on newer systems

Please note that the gem still won't compile on Linux system without systemd-journal

## v1.0.2

*October 31, 2014*

* Fixed possible memory leak in function send()

## v1.0.1

*October 30, 2014*

* Fixed wrong dependency on ruby

## v1.0.0

*October 30, 2014*

Initial release
