export async function rollbackStartupFailure(primary: unknown, cleanup: () => Promise<void>): Promise<never> {
  try {
    await cleanup();
  } catch (secondary) {
    throw combineStartupAndRollbackFailure(primary, secondary);
  }
  throw primary;
}

export function combineStartupAndRollbackFailure(primary: unknown, secondary: unknown): Error {
  const primaryMessage = primary instanceof Error ? primary.message : String(primary);
  const secondaryMessage = secondary instanceof Error ? secondary.message : String(secondary);
  return new Error(`${primaryMessage}; Test environment rollback failed: ${secondaryMessage}`, { cause: primary });
}
