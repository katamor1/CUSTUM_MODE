#include "foo_timeout.h"

#define ERR_OK 0
#define ERR_TIMEOUT -10

static int g_timeoutCount = 0;

int Foo_HandleTimeout(int timeoutDetected)
{
    if (timeoutDetected) {
        g_timeoutCount++;
        return ERR_OK;
    }

    return ERR_OK;
}

int Foo_GetTimeoutCount(void)
{
    return g_timeoutCount;
}
