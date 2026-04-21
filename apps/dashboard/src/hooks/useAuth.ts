import { useCallback, useEffect, useState } from "react";

/** 认证用户信息 */
interface AuthUser {
  userId: string;
  name: string;
  department: string;
}

/** 认证状态 */
type AuthStatus = "checking" | "authenticated" | "unauthenticated";

/**
 * 认证状态 Hook
 *
 * 检查 GET /auth/me 判断当前用户是否已登录。
 * 返回认证状态和用户信息。
 *
 * @example
 * ```tsx
 * const { status, user } = useAuth();
 * if (status === "unauthenticated") redirectToLogin();
 * ```
 */
export function useAuth(): { status: AuthStatus; user: AuthUser | null; logout: () => void } {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    fetch("/auth/me")
      .then((res) => {
        if (res.ok) return res.json();
        if (res.status === 404) {
          // Auth endpoint not configured — skip auth
          setStatus("authenticated");
          return null;
        }
        throw new Error("Unauthorized");
      })
      .then((data: AuthUser | null) => {
        if (data) setUser(data);
        setStatus("authenticated");
      })
      .catch(() => {
        setStatus("unauthenticated");
      });
  }, []);

  const logout = useCallback(() => {
    fetch("/auth/logout", { method: "POST" }).finally(() => {
      window.location.href = "/";
    });
  }, []);

  return { status, user, logout };
}
