// src/types.ts

export interface ClientOptions {
  /**
   * Your Wrangle AI API Key.
   */
  apiKey: string;
  /**
   * Base URL for the API.
   * Defaults to https://gateway.wrangleai.com/v1
   */
  baseURL?: string;
  /**
   * Timeout in milliseconds. Defaults to 60 seconds.
   */
  timeout?: number;
}

// --- Chat Completion Request ---
export interface ChatCompletionMessageParam {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}


export type WrangleModel = 
  | 'auto' 
  | 'gpt-4o' 
  | 'gpt-5-mini' 
  | 'gemini-2.5-pro'
  | (string & {});

export interface ChatCompletionMessageToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; 
  };
}

export interface ChatCompletionFunctionTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>; 
  };
}

export interface ChatCompletionWebSearchTool {
  type: 'web_search';
  web_search: {
    external_web_access: boolean;
  };
}

// The Union type allows either a standard function OR the web_search tool
export type ChatCompletionTool = 
  | ChatCompletionFunctionTool 
  | ChatCompletionWebSearchTool;

export interface ChatCompletionCreateParams {
  messages: ChatCompletionMessageParam[];
  model: WrangleModel;
  frequency_penalty?: number;
  logit_bias?: Record<string, number>;
  logprobs?: boolean;
  top_logprobs?: number;
  max_tokens?: number;
  n?: number;
  presence_penalty?: number;
  response_format?: { type: 'text' | 'json_object' };
  seed?: number;
  stop?: string | string[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  user?: string;
  tools?: Array<ChatCompletionTool>;
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
}

export interface GatewayAnnotation {
  type: 'url_citation' | (string & {});
  start_index?: number;
  end_index?: number;
  title?: string;
  url?: string;
}

export interface GatewayContent {
  type: 'output_text';
  text: string;
  annotations?: GatewayAnnotation[];
}

export interface GatewayOutputItem {
  id: string;
  type: 'message' | 'web_search_call' | (string & {});
  status?: string;
  role?: string;
  content?: GatewayContent[];
  action?: {
    type: 'search';
    query: string;
  };
}

// --- Chat Completion Response ---
export interface ChatCompletion {
  id: string;
  object: 'chat.completion' | 'response';
  created: number;
  model: string;
  choices?: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'null';
  }>;

  // Responses API (Web Search / Grounding)
  output?: GatewayOutputItem[];

  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface UsageResponse {
  total_requests: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cost: string;
  optimized: boolean;
  usage_by_model: Array<{
    model: string;
    requests: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    total_cost: string;
  }>;
}

export interface CostResponse {
  total_cost: number;
}

export interface KeyVerifyResponse {
  valid: boolean;
  message: string;
  apiKeyId: string;
  keyStatus: string;
  expiry?: string;
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'system' | 'user' | 'assistant' | 'tool';
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
}

export type Stream<Item> = AsyncIterable<Item>;