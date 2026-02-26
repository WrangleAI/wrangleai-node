// src/types.ts

export interface ClientOptions {
  /**
   * Your Wrangle AI API Key.
   * Can also be set via WRANGLEAI_API_KEY environment variable.
   */
  apiKey?: string;
  /**
   * Base URL for the API.
   * Can also be set via WRANGLEAI_BASE_URL environment variable.
   * Defaults to https://gateway.wrangleai.com/v1
   */
  baseURL?: string;
  /**
   * RAG API Base URL for files and vector stores.
   * Can also be set via WRANGLEAI_RAG_BASE_URL environment variable.
   * Auto-detected (port 8085) if not provided.
   */
  ragBaseURL?: string;
  /**
   * Timeout in milliseconds. Defaults to 60 seconds.
   */
  timeout?: number;
  /**
   * Maximum number of retries for failed requests.
   * Defaults to 2.
   */
  maxRetries?: number;
  /**
   * Custom logger instance for debugging.
   */
  logger?: Logger;
  /**
   * Log level: 'debug' | 'info' | 'warn' | 'error' | 'silent'
   * Defaults to 'silent'
   */
  logLevel?: LogLevel;
  /**
   * Danger: Allow usage in browser environments (may expose API key).
   * Defaults to false.
   */
  dangerouslyAllowBrowser?: boolean;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface Logger {
  debug(...args: any[]): void;
  info(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
}

// --- Content Parts for Multimodal Support ---

/**
 * Text content part for multimodal messages
 */
export interface ChatCompletionContentPartText {
  type: 'text';
  text: string;
}

/**
 * Image content part for multimodal messages (vision)
 * Learn more: https://platform.openai.com/docs/guides/vision
 */
export interface ChatCompletionContentPartImage {
  type: 'image_url';
  image_url: {
    /**
     * Either a URL of the image or the base64 encoded image data
     */
    url: string;
    /**
     * Specifies the detail level of the image
     */
    detail?: 'auto' | 'low' | 'high';
  };
}

/**
 * Audio content part for multimodal messages
 * Learn more: https://platform.openai.com/docs/guides/audio
 */
export interface ChatCompletionContentPartAudio {
  type: 'input_audio';
  input_audio: {
    /**
     * Base64 encoded audio data
     */
    data: string;
    /**
     * The format of the encoded audio data
     */
    format: 'wav' | 'mp3';
  };
}

/**
 * Union type for all content parts
 */
export type ChatCompletionContentPart =
  | ChatCompletionContentPartText
  | ChatCompletionContentPartImage
  | ChatCompletionContentPartAudio;

// --- Chat Completion Request ---
export interface ChatCompletionMessageParam {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /**
   * The content of the message.
   * Can be a simple string or an array of content parts for multimodal input (text, images, audio).
   */
  content: string | ChatCompletionContentPart[];
  name?: string;
}

export type WrangleModel = 'auto' | 'gpt-4o' | 'gpt-5-mini' | 'gemini-2.5-pro' | (string & {});

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
export type ChatCompletionTool = ChatCompletionFunctionTool | ChatCompletionWebSearchTool;

export interface SLMConfig {
  /**
   * Enable routing to Small Language Models (SLMs) for cost/speed optimization.
   */
  useSlm: boolean;
  /**
   * Optional category to guide the router (e.g., 'coding', 'chat', 'summarization').
   */
  useCase?:
    | 'coding'
    | 'tool_use'
    | 'reasoning'
    | 'chat'
    | 'summarization'
    | 'classification'
    | 'creative_writing'
    | 'grammar_correction'
    | 'short_copywriting'
    | 'autoformatting'
    | 'other'
    | (string & {});
}

export interface ChatCompletionCreateParams {
  messages: ChatCompletionMessageParam[];
  model: WrangleModel;
  slm?: SLMConfig;
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

  /**
   * Request ID from x-request-id header.
   * Useful for debugging and reporting issues to WrangleAI.
   */
  request_id?: string;
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

// --- Models API Response ---
export interface Model {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

export interface ModelsListResponse {
  object: 'list';
  data: Model[];
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

  /**
   * Request ID from x-request-id header.
   * Useful for debugging and reporting issues to WrangleAI.
   */
  request_id?: string;
}

export type Stream<Item> = AsyncIterable<Item>;

// --- Files API ---
export interface FileObject {
  id: string;
  object: 'file';
  bytes: number;
  created_at: number;
  filename: string;
  purpose: string;
  status?: string;
  status_details?: string;
  expires_at?: number;
}

export interface FileDeleted {
  id: string;
  object: 'file';
  deleted: boolean;
}

export interface FileListResponse {
  object: 'list';
  data: FileObject[];
  has_more: boolean;
  first_id?: string;
  last_id?: string;
}

// --- Vector Stores API ---
export interface VectorStoreFileCounts {
  total: number;
  in_progress: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export interface VectorStoreExpiresAfter {
  anchor: string;
  days: number;
}

export interface VectorStore {
  id: string;
  object: 'vector_store';
  created_at: number;
  name: string;
  usage_bytes: number;
  file_counts: VectorStoreFileCounts;
  status: 'expired' | 'in_progress' | 'completed';
  expires_after?: VectorStoreExpiresAfter;
  expires_at?: number;
  last_active_at?: number;
  metadata?: Record<string, string>;
}

export interface VectorStoreDeleted {
  id: string;
  object: 'vector_store.deleted';
  deleted: boolean;
}

export interface VectorStoreListResponse {
  object: 'list';
  data: VectorStore[];
  has_more: boolean;
  first_id?: string;
  last_id?: string;
}

// --- Vector Store Files API ---
export interface VectorStoreFileError {
  code: string;
  message: string;
}

export interface VectorStoreFile {
  id: string;
  object: 'vector_store.file';
  created_at: number;
  vector_store_id: string;
  status: 'in_progress' | 'completed' | 'cancelled' | 'failed';
  usage_bytes: number;
  last_error?: VectorStoreFileError;
  chunking_strategy?: Record<string, unknown>;
  attributes?: Record<string, string | number | boolean>;
}

export interface VectorStoreFileDeleted {
  id: string;
  object: 'vector_store.file.deleted';
  deleted: boolean;
}

export interface VectorStoreFileListResponse {
  object: 'list';
  data: VectorStoreFile[];
  has_more: boolean;
  first_id?: string;
  last_id?: string;
}

// --- Vector Store Search API ---
export interface SearchResultContent {
  type: string;
  text: string;
}

export interface SearchResultItem {
  file_id: string;
  filename: string;
  score: number;
  content: SearchResultContent[];
  attributes?: Record<string, string | number | boolean>;
}

export interface VectorStoreSearchResponse {
  object: 'vector_store.search_results.page';
  data: SearchResultItem[];
  search_query: string[];
  has_more: boolean;
  next_page?: string;
}

// --- Sustainability API ---
export interface SustainabilityEmissions {
  EnergyKWh: number;
  CarbonGrams: number;
  ConfidenceScore: number;
  ConfidenceBand: {
    Low: number;
    High: number;
  };
  Meta: {
    RegionDetected: string;
    RegionMethod: string;
  };
}

export interface ModelSustainabilityBreakdown {
  Model: string;
  RequestCount: number;
  TotalTokens: number;
  Emissions: SustainabilityEmissions;
}

export interface SustainabilityEquivalent {
  Label: string;
  Value: number;
  Unit: string;
}

export interface SustainabilityReport {
  StartDate: string;
  EndDate: string;
  TotalEnergyKWh: number;
  TotalCarbonGrams: number;
  UsageByModel: ModelSustainabilityBreakdown[];
  Equivalents: SustainabilityEquivalent[];
}

export interface RequestOptions {
  /**
   * AbortSignal to cancel the request.
   */
  signal?: AbortSignal;
  /**
   * Override timeout for this request.
   */
  timeout?: number;
  /**
   * Override maxRetries for this request.
   */
  maxRetries?: number;
}
