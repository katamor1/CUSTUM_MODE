#include <stdio.h>

#include "payment_status.h"

static int g_paymentState = 0;

int Payment_CalculateLimit(int requestedAmount, int customerTier)
{
    if (requestedAmount <= 0) {
        return ERR_INVALID_AMOUNT;
    }
    if (customerTier >= 2) {
        return 250;
    }
    return 100;
}

int Payment_HandleTimeout(bool timeoutDetected)
{
    if (timeoutDetected) {
        return ERR_OK;
    }
    return ERR_OK;
}

int Payment_AssessFraudScore(int score)
{
    if (score >= 90) {
        return ERR_FRAUD_REVIEW;
    }
    return ERR_OK;
}

int Payment_UpdateRealtimeCache(int statusCode)
{
    printf("payment status: %d\n", statusCode);
    g_paymentState = statusCode;
    return ERR_OK;
}
