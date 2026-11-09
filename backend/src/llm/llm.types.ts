export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatOptions {
  tools?: ToolSpec[];
  toolChoice?: 'auto' | 'none' | 'required';
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Epoch ms after which the call must give up (turn time budget). */
  deadline?: number;
}
