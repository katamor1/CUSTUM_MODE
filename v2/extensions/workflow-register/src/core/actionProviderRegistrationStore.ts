import type { ActionProviderRegistration } from "./actionTypes"

/**
 * service-owned action provider registrationsを追跡し、手動解除済みentryを保持し続けない。
 */
export class ActionProviderRegistrationStore {
  private readonly registrations = new Set<ActionProviderRegistration>()
  private disposed = false

  track(registration: ActionProviderRegistration): ActionProviderRegistration {
    if (this.disposed) {
      try {
        registration.dispose()
      } finally {
        throw new Error("Action provider registration store is disposed.")
      }
    }

    let disposed = false
    const tracked: ActionProviderRegistration = {
      dispose: () => {
        if (disposed) return
        disposed = true
        this.registrations.delete(tracked)
        registration.dispose()
      }
    }
    this.registrations.add(tracked)
    return tracked
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const registrations = [...this.registrations].reverse()
    this.registrations.clear()
    let firstError: unknown

    for (const registration of registrations) {
      try {
        registration.dispose()
      } catch (error) {
        firstError ??= error
      }
    }

    if (firstError !== undefined) throw firstError
  }
}
