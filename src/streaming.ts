import { ChatCompletionChunk } from './types';

/**
 * Parses a raw Node.js stream of Server-Sent Events (SSE) 
 * and yields typed ChatCompletionChunk objects.
 * 
 * @param responseStream - The raw Node.js stream (IncomingMessage)
 * @param requestId - Optional request ID from x-request-id header
 */
export async function* StreamChatCompletion(
  responseStream: any,
  requestId?: string
): AsyncIterable<ChatCompletionChunk> {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  for await (const chunk of responseStream) {
    // Decode the current chunk and append to buffer
    buffer += decoder.decode(chunk, { stream: true });

    // Split by newlines
    const lines = buffer.split('\n');
    
    // Keep the last partial line in the buffer
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Check for standard SSE prefix
      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6); // Remove 'data: '

        // Check for stream termination
        if (data === '[DONE]') {
          return;
        }

        try {
          const parsed = JSON.parse(data) as ChatCompletionChunk;
          
          // Attach request ID to chunk if available
          if (requestId) {
            parsed._request_id = requestId;
          }
          
          yield parsed;
        } catch (e) {
          console.warn('WrangleSDK: Failed to parse SSE chunk', e);
        }
      }
    }
  }
}