import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, LogIn, Mail, Lock, UserPlus } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'

export default function Login() {
  const navigate = useNavigate()
  const { login, register } = useAuthStore()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      if (mode === 'login') {
        await login(email, password)
      } else {
        await register(email, password)
      }
      navigate('/')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-fixed/15 via-surface to-secondary-fixed/10 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-on-surface">AetheL</h1>
          <p className="mt-1 text-[13px] text-on-surface-variant">面向产品构思的 AI 认知工作区</p>
        </div>

        <div className="surface-list-card rounded-[24px] p-6">
          <div className="mb-5 flex rounded-[16px] bg-white/34 p-1 ring-1 ring-white/50">
            {(['login', 'register'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setMode(item)
                  setError(null)
                }}
                className={`flex-1 rounded-[12px] py-2 text-[13px] font-semibold transition-all ${
                  mode === item ? 'bg-white/70 text-on-surface shadow-sm' : 'text-on-surface-variant'
                }`}
              >
                {item === 'login' ? '登录' : '注册'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-outline">邮箱</span>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="input-field h-11 w-full pl-9 text-[13px]"
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold text-outline">密码</span>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="至少 8 位"
                  className="input-field h-11 w-full pl-9 text-[13px]"
                />
              </div>
            </label>

            {error && (
              <div className="rounded-[14px] bg-error-container/58 px-3 py-2 text-[12px] text-on-error-container ring-1 ring-error/15">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="btn-liquid flex h-11 w-full items-center justify-center gap-2 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
            >
              {submitting ? (
                <Loader2 size={15} className="animate-spin" />
              ) : mode === 'login' ? (
                <LogIn size={15} />
              ) : (
                <UserPlus size={15} />
              )}
              {mode === 'login' ? '登录' : '创建账号'}
            </button>
          </form>

          <p className="mt-4 text-center text-[11px] leading-4 text-outline">
            账号以邮箱为唯一标识；密码加密存储。管理员由系统环境配置指定。
          </p>
        </div>
      </div>
    </div>
  )
}
