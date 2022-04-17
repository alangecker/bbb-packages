# journald-native

[![Build Status](https://travis-ci.org/theforeman/journald-native.svg?branch=master)](https://travis-ci.org/theforeman/journald-native)

A systemd-journal native logging lib wrapper.
[See sd-journal help for more info](http://www.freedesktop.org/software/systemd/man/sd_journal_print.html)

## Installation

Run

```sh
gem install journald-native
```

or add

```ruby
gem 'journald-native', '~> 1.0.11'
```

to your Gemfile.

Please note that you need a systemd development package installed in your system like `systemd-devel` in Fedora, `libsystemd-dev` in Debian, also may be a separate package for journal in older systems like `libsystemd-journal-dev`.

**NB:** The gem can be installed on non-linux system but it will do nothing there. (Functions will return success without any actual effect)

## Usage

```ruby
require 'journald/native'
```

### Constants

Constants are used to denote a log level

Available constants:

```ruby
Journald::LOG_EMERG     # system is unusable
Journald::LOG_ALERT     # action must be taken immediately
Journald::LOG_CRIT      # critical conditions
Journald::LOG_ERR       # error conditions
Journald::LOG_WARNING   # warning conditions
Journald::LOG_NOTICE    # normal but significant condition
Journald::LOG_INFO      # informational
Journald::LOG_DEBUG     # debug-level messages
```

systemd-journal uses syslog constants to denote level therefore they are equal to those of the Syslog module,
e.g. ```Journald::LOG_WARNING == Syslog::LOG_WARNING```.
[See syslog man page for more info](http://man7.org/linux/man-pages/man3/syslog.3.html)

### Methods

Methods of Journald::Native class wrap systemd-journal calls.
[See sd-journal help for more info](http://www.freedesktop.org/software/systemd/man/sd_journal_print.html)

```ruby
Journald::Native.sd_journal_send "MESSAGE=message", "PRIORITY=#{Journald::LOG_WARNING}"
Journald::Native.sd_journal_print Journald::LOG_WARNING, "message"
Journald::Native.sd_journal_perror "message"
```

It is not recommended to use `sd_journal_print` and `sd_journal_perror` as you may get exception
if your string contains `'\0'` byte due to C zero-terminated string format.
On the contrary `sd_journal_send` uses binary buffers and does not have this shortcoming.

### Short aliases

Versions prior to 1.0.11 used short function names that are available now as aliases.
They will probably throw a deprecation warning in 1.1 and be removed in 2.0 should these versions ever happen.

`Journald::Native.sd_journal_send` can be called as `Journald::Native.send`  
`Journald::Native.sd_journal_print` can be called as `Journald::Native.print`  
`Journald::Native.sd_journal_perror` can be called as `Journald::Native.perror`

**Please note that `send` method is overridden.
This is a bad practice and a reason why longer names were introduced later**

### Authors

This library was written by Anton Smirnov and currently maintained by https://www.theforeman.org developers.

### License

Copyright (c) 2014 Anton Smirnov

This library is free software; you can redistribute it and/or
modify it under the terms of the GNU Lesser General Public
License as published by the Free Software Foundation; either
version 2.1 of the License, or (at your option) any later version.

This library is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
Lesser General Public License for more details.

You can find a copy of the GNU Lesser General Public License
in COPYING.md or at <https://www.gnu.org/licenses/lgpl-2.1.txt>.
