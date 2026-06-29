#ifndef PAYMENT_STATUS_H
#define PAYMENT_STATUS_H

#include <stdbool.h>

#define ERR_OK 0
#define ERR_INVALID_AMOUNT -1
#define ERR_TIMEOUT -2
#define ERR_FRAUD_REVIEW -3

int Payment_CalculateLimit(int requestedAmount, int customerTier);
int Payment_HandleTimeout(bool timeoutDetected);
int Payment_UpdateRealtimeCache(int statusCode);

#endif
