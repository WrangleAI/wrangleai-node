import { ChatCompletionChunk } from './types';

/**
 * Parses a raw Node.js stream of Server-Sent Events (SSE) 
 * and yields typed ChatCompletionChunk objects.
 */
export async function* StreamChatCompletion(
  responseStream: any // Type is essentially IncomingMessage in Node
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
          yield parsed;
        } catch (e) {
          console.warn('WrangleSDK: Failed to parse SSE chunk', e);
        }
      }
    }
  }
}