export function isolatedOpenCodeEnvironment(base: NodeJS.ProcessEnv, dataDirectory: string): NodeJS.ProcessEnv {
  return { ...base, XDG_DATA_HOME: dataDirectory };
}
