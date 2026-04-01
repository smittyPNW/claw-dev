export function normalizeProviderName(raw: unknown): string;

export function resolvePreferredProvider(
  env?: NodeJS.ProcessEnv,
  options?: { openAIAuth?: { status?: string } },
): string;

export function resolveConfiguredProvider(
  env?: NodeJS.ProcessEnv,
  options?: { openAIAuth?: { status?: string } },
): string | null;

export function shouldPromptForModelSelection(
  env?: NodeJS.ProcessEnv,
  options?: { modelArg?: string | null | undefined },
): boolean;
