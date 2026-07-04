#include "../src/payment_status.h"

int test_premium_limit(void)
{
    PaymentContext context = { 1, 5000, 14000, 0, 0 };
    return Payment_CalculateLimit(&context) == ERR_OK;
}

int test_timeout(void)
{
    PaymentContext context = { 0, 5000, 1000, 1, 0 };
    return Payment_HandleTimeout(&context) == ERR_TIMEOUT;
}
