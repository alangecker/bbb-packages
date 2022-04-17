/**
 * journald-native ruby gem - a simple systemd-journal wrapper
 * Copyright (C) 2014 Anton Smirnov
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2.1 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA
 */

#ifndef JOURNALD_NATIVE_JOURNALD_NATIVE_H

    #include <stdbool.h>

    #define JOURNALD_NATIVE_JOURNALD_NATIVE_H

    #ifdef __linux__

        #define JOURNALD_NATIVE_SD_JOURNAL_DUMMY false

        /* do the real stuff */

        #include "extconf.h"

        /* check for extconf results */

        #ifndef HAVE_SYSTEMD_SD_JOURNAL_H
            #error Cannot include <systemd/sd-journal.h>. Please use linux version with systemd-journal installed
        #endif

        #ifndef HAVE_SD_JOURNAL_PRINT
            #error Required function sd_journal_print is missing
        #endif

        #ifndef HAVE_SD_JOURNAL_SENDV
            #error Required function sd_journal_sendv is missing
        #endif

        #ifndef HAVE_SD_JOURNAL_PERROR
            #error Required function sd_journal_perror is missing
        #endif

        /* Do not add C line and file to the log messages */
        #define SD_JOURNAL_SUPPRESS_LOCATION
        /* include systemd-journal headers */
        #include <systemd/sd-journal.h>

        /* use alias for iovec to avoid name conflicts in dummy version*/
        typedef struct iovec iovec_t;

    #else

        #define JOURNALD_NATIVE_SD_JOURNAL_DUMMY true
        #define JOURNALD_NATIVE_COMPILE_DUMMY

        #warning Compiling dummy version of the gem for non-Linux OS

        #include "journald_dummy.h"

    #endif

#endif // JOURNALD_NATIVE_SD_JOURNAL_H
