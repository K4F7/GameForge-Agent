export async function rollbackStartupFailure(primary: unknown, cleanup: () => Promise<void>): Promise<never> {
  try {
    await cleanup();
  } catch (secondary) {
    const primaryMessage = primary instanceof Error ? primary.message : String(primary);
    const secondaryMessage = secondary instanceof Error ? secondary.message : String(secondary);
    throw new Error(`${primaryMessage}; Test environment rollback failed: ${secondaryMessage}`, { cause: primary });
  }
  throw primary;
}
