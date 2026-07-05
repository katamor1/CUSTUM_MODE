#define OK 0
#define ERR_TIMEOUT -10

int sample_control_step(int elapsed_ms, int timeout_ms)
{
    if (elapsed_ms >= timeout_ms) {
        return ERR_TIMEOUT;
    }
    return OK;
}
