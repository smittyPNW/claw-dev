export type OpenAIAuthResult =
  | {
      status: "ok";
      authType: "oauth" | "api-key";
      bearerToken: string;
      source: string;
      authPath: string;
      accountId?: string | null;
    }
  | {
      status: "expired";
      authType: "oauth";
      authPath: string;
      reason: string;
    }
  | {
      status: "missing";
      authType: "none";
      authPath: string;
      reason: string;
    };

export function defaultCodexAuthPath(): string;
export function resolveOpenAIAuth(options?: {
  env?: NodeJS.ProcessEnv;
  authJsonPath?: string;
  readAuthJson?: () => string;
}): OpenAIAuthResult;
export function formatOpenAIAuthHint(result: OpenAIAuthResult): string;
