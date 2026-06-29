#include "../src/payment_status.h"

int Test_PremiumLimit(void)
{
    return Payment_CalculateLimit(120, 2) == 200 ? 0 : 1;
}

int Test_TimeoutReturnsError(void)
{
    return Payment_HandleTimeout(true) == ERR_TIMEOUT ? 0 : 1;
}
