#ifndef PAYMENT_STATUS_H
#define PAYMENT_STATUS_H

#define ERR_OK 0
#define ERR_TIMEOUT 8
#define ERR_LIMIT_EXCEEDED 12
#define ERR_FRAUD_REVIEW 20

typedef struct PaymentContextTag {
    int isPremium;
    int baseLimit;
    int dailyAmount;
    int timeoutDetected;
    int fraudScore;
} PaymentContext;

int Payment_CalculateLimit(const PaymentContext *context);
int Payment_HandleTimeout(const PaymentContext *context);
int Payment_AssessFraudScore(const PaymentContext *context);
void Payment_UpdateRealtimeCache(int statusCode);

#endif
