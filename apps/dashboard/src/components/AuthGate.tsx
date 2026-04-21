import type { ReactNode } from "react";
import { useAuth } from "../hooks/useAuth";

interface AuthGateProps {
  children: ReactNode;
}

/**
 * 认证守卫组件
 *
 * 包裹需要认证的页面内容。未认证时显示登录提示，认证后正常渲染子组件。
 * 如果 auth 端点返回 404（未启用 OAuth），则自动放行。
 *
 * @example
 * ```tsx
 * <AuthGate>
 *   <App />
 * </AuthGate>
 * ```
 */
export function AuthGate({ children }: AuthGateProps) {
  const { status, user, logout } = useAuth();

  if (status === "checking") {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-500">正在检查登录状态...</div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-sm border p-8 max-w-sm w-full text-center">
          <h1 className="text-xl font-semibold text-gray-900 mb-4">Teamsland Dashboard</h1>
          <p className="text-gray-500 mb-6">请使用飞书账号登录</p>
          <a
            href={`/auth/lark?redirect=${encodeURIComponent(window.location.pathname)}`}
            className="inline-block px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            飞书登录
          </a>
        </div>
      </div>
    );
  }

  return (
    <>
      {user && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2 bg-white rounded-full shadow-sm border px-3 py-1.5 text-xs text-gray-600">
          <span>{user.name}</span>
          <button type="button" onClick={logout} className="text-gray-400 hover:text-gray-600 transition-colors">
            登出
          </button>
        </div>
      )}
      {children}
    </>
  );
}
