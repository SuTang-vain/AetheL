// 集成测试共享辅助：注册测试用户并携带 Bearer token（用户管理系统）。
// 用法：main() 里 server listen 后调用 await registerTestUser(baseUrl)，
// 之后所有请求经 authedInit() 附加 Authorization 头。

let authToken = ''

export function setAuthToken(token: string): void {
  authToken = token
}

export function authedInit(init?: RequestInit): RequestInit {
  if (!authToken) return init || {}
  return {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${authToken}`,
    },
  }
}

export async function registerTestUser(
  baseUrl: string,
  email = 'test@aethel.local',
  password = 'testpass123',
): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await response.json()
  if (!response.ok || !data.success) {
    throw new Error(data.error || 'register test user failed')
  }
  setAuthToken(data.token)
  return data.token
}
