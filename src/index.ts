import axios, { AxiosInstance } from 'axios';
import {
  ClientOptions,
  ChatCompletionCreateParams,
  ChatCompletion,
  ChatCompletionChunk,
  UsageResponse,
  CostResponse,
  KeyVerifyResponse,
  Stream
} from './types';
import { StreamChatCompletion } from './streaming';
import {
  WrangleError,
  AuthenticationError,
  RateLimitError,
  BadRequestError,
  NotFoundError,
  APIError,
  APIConnectionError,
  makeStatusError
} from './errors';

// Re-export types and errors so users can access them easily
export * from './types';
export * from './errors';

export class WrangleAI {
  private client: AxiosInstance;
  private apiKey: string;

  constructor(options: ClientOptions) {
    if (!options.apiKey) {
      throw new Error("The WrangleAI client requires an apiKey argument");
    }

    this.apiKey = options.apiKey;
    const baseURL = options.baseURL || "https://gateway.wrangleai.com/v1";

    this.client = axios.create({
      baseURL,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: options.timeout || 60000,
    });
  }

  /**
   * Chat Completions API
   */
  public chat = {
    completions: {
      /**
       * Creates a completion for the chat message.
       */
      create: ((params: ChatCompletionCreateParams) => {
        return this.createChatRequest(params);
      }) as {
        (params: ChatCompletionCreateParams & { stream: true }): Promise<Stream<ChatCompletionChunk>>;
        (params: ChatCompletionCreateParams & { stream?: false }): Promise<ChatCompletion>;
        (params: ChatCompletionCreateParams): Promise<ChatCompletion | Stream<ChatCompletionChunk>>;
      },
    },
  };

  /**
   * Internal method to handle the branching logic for streaming vs standard
   */
  private async createChatRequest(
    params: ChatCompletionCreateParams
  ): Promise<ChatCompletion | Stream<ChatCompletionChunk>> {
    try {
      if (params.stream) {
        // Streaming Request
        const response = await this.client.post('/chat/completions', params, {
          responseType: 'stream', // Critical for Node.js axios
        });
        
        // Extract request ID from headers
        const requestId = response.headers['x-request-id'];
        
        // Pass the raw Node.js stream to our generator with request ID
        return StreamChatCompletion(response.data, requestId);

      } else {
        // Standard Request
        const response = await this.client.post<ChatCompletion>('/chat/completions', params);
        
        // Extract and attach request ID
        const requestId = response.headers['x-request-id'];
        if (requestId && response.data) {
          response.data._request_id = requestId;
        }
        
        return response.data;
      }
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Wrangle-Specific API Routes
   */
  public usage = {
    retrieve: async (params?: { startDate?: string; endDate?: string }) => {
      try {
        const response = await this.client.get<UsageResponse>('/usage', { params });
        return response.data;
      } catch (error) {
        throw this.handleError(error);
      }
    },

    retrieveByModel: async (model: string, params?: { startDate?: string; endDate?: string }) => {
      try {
        const response = await this.client.get<UsageResponse>('/usage/model', { 
          params: { ...params, model } 
        });
        return response.data;
      } catch (error) {
        throw this.handleError(error);
      }
    },
  };

  public cost = {
    retrieve: async (params?: { startDate?: string; endDate?: string }) => {
      try {
        const response = await this.client.get<CostResponse>('/cost', { params });
        return response.data;
      } catch (error) {
        throw this.handleError(error);
      }
    },
  };

  public keys = {
    verify: async () => {
      try {
        const response = await this.client.get<KeyVerifyResponse>('/keys/verify', {
          headers: {
            'X-API-Key': this.apiKey
          }
        });
        return response.data;
      } catch (error) {
        throw this.handleError(error);
      }
    },
  };

  private handleError(error: any): WrangleError {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const headers = error.response?.headers as Record<string, string> | undefined;
      
      // Extract error message from response
      let errorMessage = error.message;
      let errorData = error.response?.data;

      // If responseType is stream, data might be a Buffer, try to parse it
      if (error.response?.data && !Buffer.isBuffer(error.response.data)) {
        const data = error.response.data as any;
        errorMessage = data?.error?.message || data?.message || data?.error || error.message;
        errorData = data;
      }

      // Use structured error mapping
      return makeStatusError(status, errorData, errorMessage, headers);
    }
    
    // Network/connection errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      return new APIConnectionError(error.message, { error });
    }
    
    // Unknown errors
    return new WrangleError(error.message || 'An unknown error occurred', { error });
  }
}

export default WrangleAI;