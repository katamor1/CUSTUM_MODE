export interface DisposableLike {
  dispose: () => void
}

export type RegistrationAttemptResult<Api> =
  | { registered: false; registrations: DisposableLike[]; api?: undefined }
  | { registered: true; registrations: DisposableLike[]; api: Api }

export interface RetryRegistrationControllerOptions<Api> {
  retryDelaysMs: readonly number[]
  register: () => Promise<RegistrationAttemptResult<Api>>
  currentApi: () => Api | undefined
  subscribeChanges: (listener: () => void) => DisposableLike
  own: (...disposables: DisposableLike[]) => void
  reportError: (error: unknown) => void
}

/**
 * Optional extension integrationを再試行し、API世代変更とdeactivate競合を安全に処理する。
 */
export function startRetryRegistrationController<Api>(
  options: RetryRegistrationControllerOptions<Api>
): DisposableLike {
  let disposed = false
  let providersRegistered = false
  let generation = 0
  let registeredApi: Api | undefined
  let registrationAttempt: Promise<boolean> | undefined
  let activeRegistrations: DisposableLike[] = []
  let retryIndex = 0
  const timers = new Set<ReturnType<typeof setTimeout>>()

  const clearRetryTimers = (): void => {
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
  }

  const disposeRegistrations = (registrations: DisposableLike[]): void => {
    for (const registration of [...registrations].reverse()) registration.dispose()
    registrations.length = 0
  }

  const resetRegistration = (): void => {
    generation += 1
    registrationAttempt = undefined
    disposeRegistrations(activeRegistrations)
    activeRegistrations = []
    registeredApi = undefined
    providersRegistered = false
  }

  const scheduleRetry = (): void => {
    if (disposed || providersRegistered || retryIndex >= options.retryDelaysMs.length) return
    const timer = setTimeout(() => {
      timers.delete(timer)
      void attempt()
    }, options.retryDelaysMs[retryIndex])
    retryIndex += 1
    timers.add(timer)
  }

  const performAttempt = async (attemptGeneration: number): Promise<boolean> => {
    const result = await options.register()
    if (disposed || attemptGeneration !== generation) {
      disposeRegistrations(result.registrations)
      return false
    }
    if (!result.registered) {
      disposeRegistrations(result.registrations)
      scheduleRetry()
      return false
    }
    if (result.api === undefined) {
      disposeRegistrations(result.registrations)
      options.reportError(new Error("Provider registration succeeded without API identity."))
      scheduleRetry()
      return false
    }

    activeRegistrations = result.registrations
    registeredApi = result.api
    providersRegistered = true
    return true
  }

  const attempt = async (): Promise<boolean> => {
    if (disposed || providersRegistered) return providersRegistered
    if (registrationAttempt) return registrationAttempt

    const attemptGeneration = generation
    const currentAttempt = performAttempt(generation)
    registrationAttempt = currentAttempt
    try {
      return await currentAttempt
    } catch (error) {
      options.reportError(error)
      if (!disposed && attemptGeneration === generation) scheduleRetry()
      return false
    } finally {
      if (registrationAttempt === currentAttempt) registrationAttempt = undefined
    }
  }

  const changeSubscription = options.subscribeChanges(() => {
    const currentApi = options.currentApi()
    if (providersRegistered && currentApi === registeredApi) return
    resetRegistration()
    retryIndex = 0
    clearRetryTimers()
    void attempt()
  })

  const controller: DisposableLike = {
    dispose: () => {
      if (disposed) return
      disposed = true
      clearRetryTimers()
      resetRegistration()
      changeSubscription.dispose()
    }
  }

  options.own(controller)
  void attempt()
  return controller
}
