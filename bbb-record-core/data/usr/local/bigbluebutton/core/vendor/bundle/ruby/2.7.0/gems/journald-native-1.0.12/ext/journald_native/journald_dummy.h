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

/* dummy code to be used in sd_journal.h on non-linux system */


#ifdef  JOURNALD_NATIVE_COMPILE_DUMMY
#ifndef JOURNALD_NATIVE_JOURNALD_DUMMY_H
#define JOURNALD_NATIVE_JOURNALD_DUMMY_H

#include <stdlib.h>

#ifndef LOG_EMERG
    /* syslog constants */
    #define LOG_EMERG   0
    #define LOG_ALERT   1
    #define LOG_CRIT    2
    #define LOG_ERR     3
    #define LOG_WARNING 4
    #define LOG_NOTICE  5
    #define LOG_INFO    6
    #define LOG_DEBUG   7
#endif

typedef struct jdn_dummy_iovec iovec_t;

/* iovec */
struct jdn_dummy_iovec {
    void  *iov_base;    /* Starting address */
    size_t iov_len;     /* Number of bytes to transfer */
};

int sd_journal_print(int priority, const char *format, ...);
int sd_journal_sendv(const iovec_t *iov, int n);
int sd_journal_perror(const char *message);

#endif
#endif
