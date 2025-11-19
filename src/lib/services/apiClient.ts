/**
 * Base API client with authentication and error handling
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3233';
const API_USERNAME = import.meta.env.VITE_API_USERNAME || 'admin';
const API_PASSWORD = import.meta.env.VITE_API_PASSWORD || 'pa55word';

/**
 * Custom error class for API errors
 */
export class APIError extends Error {
  constructor(
    message: string,
    public status?: number,
    public statusText?: string
  ) {
    super(message);
    this.name = 'APIError';
  }
}

/**
 * Creates Basic Auth header value
 */
function getAuthHeader(): string {
  const credentials = btoa(`${API_USERNAME}:${API_PASSWORD}`);
  return `Basic ${credentials}`;
}

/**
 * Base fetch wrapper with authentication and error handling
 */
export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  // Merge default headers with provided headers
  const headers = new Headers(options.headers);
  headers.set('Authorization', getAuthHeader());

  // Create abort controller for timeout (2 minutes for OCR requests)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000); // 120 seconds

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Handle non-OK responses
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new APIError(
        `API request failed: ${errorText}`,
        response.status,
        response.statusText
      );
    }

    // Return response based on content type
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return (await response.json()) as T;
    } else if (contentType?.includes('text/')) {
      return (await response.text()) as T;
    } else {
      return (await response.blob()) as T;
    }
  } catch (error) {
    clearTimeout(timeoutId);

    // Re-throw APIError as-is
    if (error instanceof APIError) {
      throw error;
    }

    // Handle abort errors (timeout)
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new APIError(
        'Request timeout: OCR processing took too long. Please try with a smaller file or fewer pages.'
      );
    }

    // Wrap network errors
    if (error instanceof TypeError) {
      throw new APIError(
        `Network error: Unable to connect to API server at ${API_BASE_URL}. Make sure the backend is running.`
      );
    }

    // Wrap other errors
    throw new APIError(
      error instanceof Error ? error.message : 'Unknown error occurred'
    );
  }
}

/**
 * GET request helper
 */
export async function apiGet<T = any>(endpoint: string): Promise<T> {
  return apiRequest<T>(endpoint, { method: 'GET' });
}

/**
 * POST request helper
 */
export async function apiPost<T = any>(
  endpoint: string,
  body?: BodyInit
): Promise<T> {
  return apiRequest<T>(endpoint, {
    method: 'POST',
    body,
  });
}

/**
 * Checks if the API server is reachable
 */
export async function checkAPIHealth(): Promise<boolean> {
  try {
    await apiGet('/api/status');
    return true;
  } catch {
    return false;
  }
}
