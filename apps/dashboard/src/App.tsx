import { ErrorCard } from "@teamsland/ui/components/ui/error-card";
import { useCallback } from "react";
import { ErrorBoundary, getErrorMessage } from "react-error-boundary";
import { NavSidebar } from "./components/layout/NavSidebar";
import { SessionDetailLayout } from "./components/layout/SessionDetailLayout";
import type { PageName } from "./hooks/useRouter";
import { useRouter } from "./hooks/useRouter";
import { useTheme } from "./hooks/useTheme";
import { CoordinatorPage } from "./pages/CoordinatorPage";
import { HooksPage } from "./pages/HooksPage";
import { MemoryPage } from "./pages/MemoryPage";
import { OverviewPage } from "./pages/OverviewPage";
import { SessionsListPage } from "./pages/SessionsListPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TicketsPage } from "./pages/TicketsPage";

/**
 * 应用根组件
 *
 * 左侧全局 NavSidebar + 右侧页面内容。
 * 根据 URL hash 路由切换页面。
 */
export function App() {
  useTheme();
  const { page, segments, query, navigate, setQuery } = useRouter();

  const handlePageNav = useCallback(
    (target: PageName) => {
      const paths: Record<PageName, string> = {
        overview: "/",
        sessions: "/sessions",
        tickets: "/tickets",
        coordinator: "/coordinator",
        hooks: "/hooks",
        memory: "/memory",
        settings: "/settings",
      };
      navigate(paths[target]);
    },
    [navigate],
  );

  const handlePathNav = useCallback(
    (path: string) => {
      navigate(path);
    },
    [navigate],
  );

  // Sessions 页面：有 sessionId 时显示详情，否则显示列表
  const sessionId = segments.sessionId;
  const project = segments.project;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      {/* 全局导航栏 */}
      <NavSidebar activePage={page} onNavigate={handlePageNav} />

      {/* 页面内容 */}
      <main className="flex-1 min-w-0 overflow-hidden">
        {page === "overview" && (
          <ErrorBoundary
            fallbackRender={({ error, resetErrorBoundary }) => (
              <ErrorCard title="页面崩溃" message={getErrorMessage(error)} onRetry={resetErrorBoundary} />
            )}
          >
            <OverviewPage onNavigate={handlePathNav} />
          </ErrorBoundary>
        )}

        {page === "sessions" && !sessionId && (
          <ErrorBoundary
            fallbackRender={({ error, resetErrorBoundary }) => (
              <ErrorCard title="页面崩溃" message={getErrorMessage(error)} onRetry={resetErrorBoundary} />
            )}
          >
            <SessionsListPage onNavigate={handlePathNav} />
          </ErrorBoundary>
        )}

        {page === "sessions" && sessionId && (
          <ErrorBoundary
            fallbackRender={({ error, resetErrorBoundary }) => (
              <ErrorCard title="页面崩溃" message={getErrorMessage(error)} onRetry={resetErrorBoundary} />
            )}
          >
            <SessionDetailLayout sessionId={sessionId} projectName={project ?? null} onNavigate={handlePathNav} />
          </ErrorBoundary>
        )}

        {page === "hooks" && (
          <ErrorBoundary
            fallbackRender={({ error, resetErrorBoundary }) => (
              <ErrorCard title="页面崩溃" message={getErrorMessage(error)} onRetry={resetErrorBoundary} />
            )}
          >
            <HooksPage activeTab={query.tab} onTabChange={(tab) => setQuery({ tab })} />
          </ErrorBoundary>
        )}

        {page === "tickets" && (
          <ErrorBoundary
            fallbackRender={({ error, resetErrorBoundary }) => (
              <ErrorCard title="页面崩溃" message={getErrorMessage(error)} onRetry={resetErrorBoundary} />
            )}
          >
            <TicketsPage issueId={segments.issueId} onNavigate={handlePathNav} />
          </ErrorBoundary>
        )}

        {page === "coordinator" && (
          <ErrorBoundary
            fallbackRender={({ error, resetErrorBoundary }) => (
              <ErrorCard title="页面崩溃" message={getErrorMessage(error)} onRetry={resetErrorBoundary} />
            )}
          >
            <CoordinatorPage />
          </ErrorBoundary>
        )}

        {page === "memory" && (
          <ErrorBoundary
            fallbackRender={({ error, resetErrorBoundary }) => (
              <ErrorCard title="页面崩溃" message={getErrorMessage(error)} onRetry={resetErrorBoundary} />
            )}
          >
            <MemoryPage selectedUri={query.uri} onUriChange={(uri) => setQuery({ uri })} />
          </ErrorBoundary>
        )}

        {page === "settings" && (
          <ErrorBoundary
            fallbackRender={({ error, resetErrorBoundary }) => (
              <ErrorCard title="页面崩溃" message={getErrorMessage(error)} onRetry={resetErrorBoundary} />
            )}
          >
            <SettingsPage />
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
}
