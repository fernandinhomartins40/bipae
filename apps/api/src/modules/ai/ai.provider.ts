/**
 * Interface própria do provedor de IA (ADR-0011): o Bipaê fala com ela, nunca direto com um
 * fornecedor, para permitir a troca. A implementação de referência usa a API de mensagens dos
 * modelos Claude; os testes usam um provedor simulado com as mesmas formas.
 */

export type AiContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface AiMessage {
  role: 'user' | 'assistant';
  content: AiContent[];
}

export interface AiTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AiRequest {
  system: string;
  messages: AiMessage[];
  tools?: AiTool[];
  /** Obriga a resposta a usar esta ferramenta (saída estruturada). */
  forceTool?: string;
  maxTokens: number;
}

export interface AiResponse {
  content: AiContent[];
  stopReason: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface AiProvider {
  readonly model: string;
  complete(request: AiRequest): Promise<AiResponse>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Modelos Claude pela API de mensagens (https://api.anthropic.com/v1/messages). */
export class ClaudeProvider implements AiProvider {
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly baseUrl = 'https://api.anthropic.com',
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async complete(request: AiRequest): Promise<AiResponse> {
    const response = await this.fetchFn(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: request.messages,
        ...(request.tools && { tools: request.tools }),
        ...(request.forceTool && { tool_choice: { type: 'tool', name: request.forceTool } }),
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      // O corpo do erro não vai para o log: pode ecoar o pedido.
      throw new AiProviderError(`O provedor de IA respondeu ${response.status}.`, response.status);
    }
    const body = (await response.json()) as {
      content: AiContent[];
      stop_reason: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    return {
      content: body.content.filter((c) => c.type === 'text' || c.type === 'tool_use'),
      stopReason: body.stop_reason,
      usage: {
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
      },
    };
  }
}
