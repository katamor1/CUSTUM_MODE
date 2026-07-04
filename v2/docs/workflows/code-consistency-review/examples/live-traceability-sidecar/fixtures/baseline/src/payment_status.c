#include "payment_status.h"

int Payment_CalculateLimit(const PaymentContext *context)
{
    int limit = context->baseLimit;

    if (context->isPremium) {
        limit += 5000;
    }

    if (context->dailyAmount > limit) {
        return ERR_LIMIT_EXCEEDED;
    }

    return ERR_OK;
}

int Payment_HandleTimeout(const PaymentContext *context)
{
    if (context->timeoutDetected) {
        return ERR_TIMEOUT;
    }

    return ERR_OK;
}

int Payment_AssessFraudScore(const PaymentContext *context)
{
    if (context->fraudScore >= 80) {
        return ERR_FRAUD_REVIEW;
    }

    return ERR_OK;
}

void Payment_UpdateRealtimeCache(int statusCode)
{
    (void)statusCode;
}
