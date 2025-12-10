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

// Re-export types so users can access them easily
export * from './types';

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
        
        // Pass the raw Node.js stream to our generator
        return StreamChatCompletion(response.data);

      } else {
        // Standard Request
        const response = await this.client.post<ChatCompletion>('/chat/completions', params);
        return response.data;
      }
    } catch (error) {
      this.handleError(error);
      throw error;
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
        this.handleError(error);
        throw error;
      }
    },

    retrieveByModel: async (model: string, params?: { startDate?: string; endDate?: string }) => {
      try {
        const response = await this.client.get<UsageResponse>('/usage/model', { 
          params: { ...params, model } 
        });
        return response.data;
      } catch (error) {
        this.handleError(error);
        throw error;
      }
    },
  };

  public cost = {
    retrieve: async (params?: { startDate?: string; endDate?: string }) => {
      try {
        const response = await this.client.get<CostResponse>('/cost', { params });
        return response.data;
      } catch (error) {
        this.handleError(error);
        throw error;
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
        this.handleError(error);
        throw error;
      }
    },
  };

  private handleError(error: any): void {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      // If responseType is stream, data might be a Buffer, try to parse it if possible, 
      // otherwise fallback to status text.
      let errorMessage = error.message;

      if (error.response?.data && !Buffer.isBuffer(error.response.data)) {
        const data = error.response.data as any;
        errorMessage = data?.error?.message || data?.error || error.message;
      }

      throw new Error(`WrangleAI Error [${status}]: ${errorMessage}`);
    }
    throw error;
  }
}

export default WrangleAI;