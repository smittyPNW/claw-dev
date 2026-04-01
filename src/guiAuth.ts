import { formatOpenAIAuthHint, resolveOpenAIAuth } from "../shared/openaiAuth.js";

type OpenAIAuthOptions = {
  env?: NodeJS.ProcessEnv;
  authJsonPath?: string;
  readAuthJson?: () => string;
};

export type OpenAIAuthStatus = "configured" | "expired" | "missing-auth";

export type OpenAIAuthPanelState = {
  status: OpenAIAuthStatus;
  authType: "oauth" | "api-key" | "none";
  sourceLabel: string;
  shortDetail: string;
  detail: string;
  nextAction: string;
  actionLabel: string;
  actionCommand: string;
  authPath: string;
  accountId: string | null;
  canUseOpenAI: boolean;
  prefersChatGPTSession: boolean;
  checkedAt: string;
};

export function getOpenAIAuthPanelState(options: OpenAIAuthOptions = {}): OpenAIAuthPanelState {
  const result = resolveOpenAIAuth(options);
  const checkedAt = new Date().toISOString();

  if (result.status === "ok" && result.authType === "oauth") {
    return {
      status: "configured",
      authType: "oauth",
      sourceLabel: "Saved ChatGPT session",
      shortDetail: `Using saved ChatGPT session from ${result.authPath}.`,
      detail:
        "A reusable local ChatGPT session is active on this machine, so the OpenAI lane can act as the default provider without needing a separate API key.",
      nextAction:
        "Keep this as the default lane. If requests start failing or the session ages out, run codex login and then refresh this panel.",
      actionLabel: "Copy re-auth command",
      actionCommand: "codex login",
      authPath: result.authPath,
      accountId: result.accountId ?? null,
      canUseOpenAI: true,
      prefersChatGPTSession: true,
      checkedAt,
    };
  }

  if (result.status === "ok" && result.authType === "api-key") {
    return {
      status: "configured",
      authType: "api-key",
      sourceLabel: "Environment API key",
      shortDetail: "Using OPENAI_API_KEY from the environment.",
      detail:
        "The OpenAI lane is ready through OPENAI_API_KEY. This works well, but it is not currently using a saved ChatGPT session on this machine.",
      nextAction:
        "You can keep using the API key, or run codex login if you want the GUI to default to a reusable local ChatGPT session instead.",
      actionLabel: "Copy ChatGPT login command",
      actionCommand: "codex login",
      authPath: result.authPath,
      accountId: null,
      canUseOpenAI: true,
      prefersChatGPTSession: false,
      checkedAt,
    };
  }

  if (result.status === "expired") {
    return {
      status: "expired",
      authType: "oauth",
      sourceLabel: "Expired saved session",
      shortDetail: `Saved ChatGPT session expired at ${result.authPath}.`,
      detail: formatOpenAIAuthHint(result),
      nextAction: "Run codex login in a terminal, then press refresh here to verify the session is live again.",
      actionLabel: "Copy re-auth command",
      actionCommand: "codex login",
      authPath: result.authPath,
      accountId: null,
      canUseOpenAI: false,
      prefersChatGPTSession: false,
      checkedAt,
    };
  }

  return {
    status: "missing-auth",
    authType: "none",
    sourceLabel: "No saved session",
    shortDetail: `No reusable ChatGPT session found at ${result.authPath}.`,
    detail: formatOpenAIAuthHint(result),
    nextAction:
      "Run codex login to create a reusable local ChatGPT session, or set OPENAI_API_KEY if you want to use the OpenAI lane without saved session auth.",
    actionLabel: "Copy setup command",
    actionCommand: "codex login",
    authPath: result.authPath,
    accountId: null,
    canUseOpenAI: false,
    prefersChatGPTSession: false,
    checkedAt,
  };
}
