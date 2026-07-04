export interface CloseEventLike {
  preventDefault(): void;
}

export interface CloseCoordinatorOptions {
  hasActiveJob: () => boolean;
  cancel: () => Promise<void>;
  finalizeClose: () => void;
}

export interface CloseCoordinator {
  handleClose(event: CloseEventLike): Promise<void>;
}

export function createCloseCoordinator(
  options: CloseCoordinatorOptions
): CloseCoordinator {
  let allowClose = false;
  let closing: Promise<void> | undefined;

  return {
    handleClose: async (event) => {
      if (allowClose || !options.hasActiveJob()) {
        return;
      }

      event.preventDefault();
      closing ??= (async () => {
        try {
          await options.cancel();
        } finally {
          allowClose = true;
          options.finalizeClose();
        }
      })();
      await closing;
    }
  };
}
