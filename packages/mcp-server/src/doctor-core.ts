export type DoctorPreflightInput = {
  nodeVersion: string;
  bunVersion: string | null;
  serverEntryExists: boolean;
  bunLockExists: boolean;
  packageLockExists: boolean;
};

export type DoctorIssue = {
  code: "node_version" | "bun_version" | "server_not_built" | "bun_lock_missing" | "parallel_lockfile";
  message: string;
};

export function evaluateDoctorPreflight(input: DoctorPreflightInput): ReadonlyArray<DoctorIssue> {
  const issues: DoctorIssue[] = [];
  if (!versionAtLeast(input.nodeVersion, [22, 12, 0])) {
    issues.push({ code: "node_version", message: "Node 22.12.0 or newer is required." });
  }
  if (input.bunVersion === null || !versionAtLeast(input.bunVersion, [1, 3, 14])) {
    issues.push({ code: "bun_version", message: "Bun 1.3.14 or newer is required." });
  }
  if (!input.serverEntryExists) {
    issues.push({ code: "server_not_built", message: "Built MCP entry is missing." });
  }
  if (!input.bunLockExists) {
    issues.push({ code: "bun_lock_missing", message: "bun.lock is missing." });
  }
  if (input.packageLockExists) {
    issues.push({ code: "parallel_lockfile", message: "package-lock.json must not coexist with bun.lock." });
  }
  return issues;
}

export function redactEnvironmentValues(message: string, environment: NodeJS.ProcessEnv): string {
  const alwaysSensitiveNames = new Set([
    "DASHSCOPE_API_KEY",
    "VOLCENGINE_ARK_API_KEY",
    "FREESOUND_API_KEY",
    "VOLCENGINE_SPEECH_API_TOKEN",
    "VOLCENGINE_SPEECH_APP_ID",
    "MINIMAX_API_KEY",
  ]);
  const privateName = /(?:^|_)(?:AK|SK|KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|LICENSE|PATH|DIR|FILE|ROOT|CLI|BIN)(?:_|$)/i;
  const values = Object.entries(environment)
    .filter(([name]) => alwaysSensitiveNames.has(name) || privateName.test(name))
    .flatMap(([, value]) => value?.trim() === undefined || value.trim().length === 0 ? [] : [value.trim()])
    .sort((left, right) => right.length - left.length);
  return values.reduce((result, value) => result.split(value).join("[REDACTED]"), message);
}

export function sanitizeDoctorDiagnostic(
  message: string,
  environment: NodeJS.ProcessEnv,
  localPaths: readonly string[] = [],
): string {
  const knownLocalPaths = [
    ...localPaths,
    environment.USERPROFILE,
    environment.HOME,
    environment.TEMP,
    environment.TMP,
  ].flatMap((value) => value?.trim() === undefined || value.trim().length === 0 ? [] : [value.trim()])
    .sort((left, right) => right.length - left.length);
  const withoutPaths = knownLocalPaths.reduce(
    (result, value) => result.split(value).join("[LOCAL_PATH]"),
    redactEnvironmentValues(message, environment),
  );
  return withoutPaths.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

export function expectedConditionalTools(snapshot: {
  providers: { spec: { ready: boolean }; image: { ready: boolean }; tts: { ready: boolean }; sound: { ready: boolean }; music: { ready: boolean } };
  engineering: { assetStore: boolean; generator: boolean; verifier: boolean; preview: boolean; runRelay: boolean; taskInbox: boolean };
}): ReadonlyArray<string> {
  return [
    ...(snapshot.providers.spec.ready ? ["draft_game_spec"] : []),
    ...(snapshot.providers.image.ready ? ["request_image_asset"] : []),
    ...(snapshot.providers.tts.ready ? ["submit_voice_job", "query_voice_job", "materialize_voice_job"] : []),
    ...(snapshot.providers.sound.ready ? ["search_sound_asset", "import_sound_asset"] : []),
    ...(snapshot.providers.music.ready ? ["generate_music_asset"] : []),
    ...(snapshot.engineering.assetStore ? ["get_project_assets", "recover_project_assets"] : []),
    ...(snapshot.engineering.generator ? ["generate_game_project", "recover_game_project_update"] : []),
    ...(snapshot.engineering.verifier ? ["verify_game_project"] : []),
    ...(snapshot.engineering.preview ? ["start_game_preview", "stop_game_preview"] : []),
    ...(snapshot.engineering.runRelay
      ? ["create_game_run", "replay_game_run", "publish_run_events", "complete_game_run", "stop_game_run"]
      : []),
    ...(snapshot.engineering.taskInbox
      ? ["create_game_task", "list_game_tasks", "get_game_task", "claim_game_task", "freeze_task_acceptance_contract", "transition_game_task"]
      : []),
  ].sort();
}

function versionAtLeast(version: string, required: readonly [number, number, number]): boolean {
  const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (match === null) return false;
  const actual = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  for (let index = 0; index < required.length; index += 1) {
    const value = actual[index] ?? 0;
    const minimum = required[index] ?? 0;
    if (value > minimum) return true;
    if (value < minimum) return false;
  }
  return true;
}
