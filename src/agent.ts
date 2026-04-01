import {
  AnthropicProvider,
  GeminiProvider,
  OllamaProvider,
  OpenRouterProvider,
  type LlmProvider,
  type ProviderName,
  type TurnEventHandler,
} from "./providers.js";

export type AgentTurnResult = {
  text: string;
};

export class CodingAgent {
  private readonly provider: LlmProvider;

  constructor(args: { provider: ProviderName; apiKey: string; model: string; cwd: string; baseUrl?: string }) {
    if (args.provider === "gemini") {
      this.provider = new GeminiProvider({
        apiKey: args.apiKey,
        model: args.model,
        cwd: args.cwd,
      });
      return;
    }

    if (args.provider === "openrouter") {
      this.provider = new OpenRouterProvider(
        args.baseUrl !== undefined
          ? {
              apiKey: args.apiKey,
              model: args.model,
              cwd: args.cwd,
              baseUrl: args.baseUrl,
            }
          : {
              apiKey: args.apiKey,
              model: args.model,
              cwd: args.cwd,
            },
      );
      return;
    }

    if (args.provider === "ollama") {
      this.provider = new OllamaProvider(
        args.baseUrl !== undefined
          ? {
              apiKey: args.apiKey,
              model: args.model,
              cwd: args.cwd,
              baseUrl: args.baseUrl,
            }
          : {
              apiKey: args.apiKey,
              model: args.model,
              cwd: args.cwd,
            },
      );
      return;
    }

    this.provider = new AnthropicProvider({
      apiKey: args.apiKey,
      model: args.model,
      cwd: args.cwd,
    });
  }

  clear(): void {
    this.provider.clear();
  }

  async runTurn(prompt: string, onEvent?: TurnEventHandler): Promise<AgentTurnResult> {
    return this.provider.runTurn(prompt, onEvent);
  }
}
