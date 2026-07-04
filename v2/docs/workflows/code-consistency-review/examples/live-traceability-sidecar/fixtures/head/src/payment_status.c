#include "payment_status.h"
#include <stdio.h>

static int g_paymentRealtimeStatus;

int Payment_CalculateLimit(const PaymentContext *context)
{
    int limit = context->baseLimit;

    if (context->isPremium) {
        limit += 10000;
    }

    if (context->dailyAmount > limit) {
        return ERR_LIMIT_EXCEEDED;
    }

    return ERR_OK;
}

int Payment_HandleTimeout(const PaymentContext *context)
{
    if (context->timeoutDetected) {
        return ERR_OK;
    }

    return ERR_OK;
}

int Payment_AssessFraudScore(const PaymentContext *context)
{
    if (context->fraudScore > 95) {
        return ERR_FRAUD_REVIEW;
    }

    return ERR_OK;
}

void Payment_UpdateRealtimeCache(int statusCode)
{
    g_paymentRealtimeStatus = statusCode;
    printf("payment status: %d\n", statusCode);
}
