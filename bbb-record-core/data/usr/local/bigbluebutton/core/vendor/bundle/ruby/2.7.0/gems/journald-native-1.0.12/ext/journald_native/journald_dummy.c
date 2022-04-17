#include "journald_native.h"

#ifdef JOURNALD_NATIVE_COMPILE_DUMMY

int sd_journal_print(int priority, const char *format, ...)  { return 0; }
int sd_journal_sendv(const iovec_t *iov, int n)              { return 0; }
int sd_journal_perror(const char *message)                   { return 0; }

#endif
