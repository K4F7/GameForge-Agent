export type BrowserDoctorIssue = { code: "runtime" | "executable" | "launch" | "startup"; message: string };

export function classifyBrowserDoctorError(error: unknown): BrowserDoctorIssue {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("requires the Node runtime")) return { code: "runtime", message: "Chrome verification must run under Node." };
  if (message.includes("Chrome executable")) return { code: "executable", message: "The configured Chrome executable is unavailable." };
  if (/launch|browserType/i.test(message)) return { code: "launch", message: "Chrome could not be launched by Playwright." };
  return { code: "startup", message: "Chrome session setup failed." };
}
