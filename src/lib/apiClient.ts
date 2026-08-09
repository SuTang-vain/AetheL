const LOCAL_API_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000']

export const AUTH_TOKEN_KEY = 'aethel-token'

function withAuth(init?: RequestInit): RequestInit {
  if (typeof window === 'undefined') return init || {}
  const token = window.localStorage?.getItem?.(AUTH_TOKEN_KEY)
  if (!token) return init || {}
  return {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  }
}

function shouldTryLocalFallback(error?: unknown, response?: Response) {
  if (error) return true
  if (!response) return false
  if (response.status === 404) return true
  if ([500, 502, 503, 504].includes(response.status)) return false
  const contentType = response.headers.get('content-type') || ''
  return response.ok && contentType.includes('text/html')
}

function isLocalBrowser() {
  if (typeof window === 'undefined') return false
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const authedInit = withAuth(init)
  let sameOriginResponse: Response | null = null
  let sameOriginError: unknown = null

  try {
    sameOriginResponse = await fetch(path, authedInit)
    if (!shouldTryLocalFallback(undefined, sameOriginResponse)) {
      return sameOriginResponse
    }
  } catch (error) {
    sameOriginError = error
  }

  if (isLocalBrowser()) {
    for (const origin of LOCAL_API_ORIGINS) {
      try {
        const fallbackResponse = await fetch(`${origin}${path}`, authedInit)
        if (fallbackResponse.ok || !shouldTryLocalFallback(undefined, fallbackResponse)) {
          return fallbackResponse
        }
      } catch {
        // try the next local origin
      }
    }
  }

  if (sameOriginResponse) return sameOriginResponse
  throw sameOriginError instanceof Error ? sameOriginError : new Error('API request failed')
}
