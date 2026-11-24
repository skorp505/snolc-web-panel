import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowUpFromLine,
  CheckCircle2,
  Download,
  FileText,
  KeyRound,
  Lock,
  LogOut,
  RefreshCw,
  RotateCw,
  Save,
  Server,
  Settings,
  Terminal,
  Upload,
  User,
  X,
  ChevronDown,
} from "lucide-react";
import "./index.css";

type AuthMe = { user: string; setup_required?: boolean };
type StateInfo = {
  installed_version: string;
  latest_version: string;
  running: boolean;
  pid: number | null;
  log_path: string;
  config_path: string;
};
type ConfigInfo = { path: string; content: string; exists: boolean };
type LogInfo = { running: string; progress: number; log: string };
type UpdateInfo = {
  current: string;
  latest: string;
  update_available: boolean;
  checking: boolean;
  error: string;
  changelog: string;
};

async function request(path: string, options?: RequestInit) {
  const res = await fetch(path, options);
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("snolc-auth-required"));
    throw new Error((await res.text()).trim() || res.statusText);
  }
  return res;
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-normal">{value}</div>
    </div>
  );
}

function HeaderMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid h-9 min-w-24 content-center rounded-md border border-border bg-card px-3">
      <div className="text-[10px] uppercase leading-3 text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold leading-4">{value}</div>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
          <button
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted hover:bg-muted/80"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function LoginView({ setupRequired, onReady }: { setupRequired: boolean; onReady: () => void }) {
  const [user, setUser] = useState("admin");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (setupRequired && password !== repeat) throw new Error("Пароли не совпадают");
      await request(setupRequired ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, password }),
      });
      onReady();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-background px-5">
      <form className="grid w-full max-w-sm gap-4 rounded-lg border border-border bg-card p-5" onSubmit={submit}>
        <div className="grid h-10 w-10 place-items-center rounded-md bg-primary/15 text-primary">
          <Lock className="h-5 w-5" />
        </div>
        <h1 className="text-xl font-semibold tracking-normal">SNOLC Web</h1>
        <div className="text-sm text-muted-foreground">{setupRequired ? "Первичная настройка" : "Вход в панель"}</div>
        <label className="grid gap-2 text-sm text-muted-foreground">
          Логин
          <input
            className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
            value={user}
            onChange={(event) => setUser(event.target.value)}
            autoComplete="username"
          />
        </label>
        <label className="grid gap-2 text-sm text-muted-foreground">
          Пароль
          <input
            className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={setupRequired ? "new-password" : "current-password"}
          />
        </label>
        {setupRequired && (
          <label className="grid gap-2 text-sm text-muted-foreground">
            Повтор пароля
            <input
              className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
              type="password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
              autoComplete="new-password"
            />
          </label>
        )}
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-black hover:bg-primary/90 disabled:opacity-60"
          disabled={busy}
        >
          <Lock className="h-4 w-4" />
          {setupRequired ? "Сохранить пароль" : "Войти"}
        </button>
      </form>
    </div>
  );
}

function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [user, setUser] = useState("admin");
  const [notice, setNotice] = useState("");

  const checkAuth = async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (!res.ok) {
        try {
          const body = (await res.json()) as { setup_required?: boolean };
          setSetupRequired(Boolean(body.setup_required));
        } catch {
          setSetupRequired(false);
        }
        setAuthenticated(false);
        return;
      }
      const body = (await res.json()) as AuthMe;
      setSetupRequired(Boolean(body.setup_required));
      setUser(body.user || "admin");
      if (body.setup_required) {
        setAuthenticated(false);
        return;
      }
      setAuthenticated(true);
    } catch {
      setAuthenticated(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    const handler = () => checkAuth();
    window.addEventListener("snolc-auth-required", handler);
    return () => window.removeEventListener("snolc-auth-required", handler);
  }, []);

  const afterLogin = async () => {
    setNotice("");
    try {
      await checkAuth();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  if (!authenticated) return <LoginView setupRequired={setupRequired} onReady={() => void afterLogin()} />;
  return <Panel user={user} notice={notice} />;
}

function Panel({ user, notice }: { user: string; notice: string }) {
  const [showLog, setShowLog] = useState(false);
  const [showInstallLog, setShowInstallLog] = useState(false);
  const [logoutBtnBusy, setLogoutBtnBusy] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const installLogRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshData();
    }, 4000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [state, setState] = useState<StateInfo>({
    installed_version: "",
    latest_version: "",
    running: false,
    pid: null,
    log_path: "",
    config_path: "",
  });
  const [config, setConfig] = useState<ConfigInfo>({ path: "", content: "", exists: false });
  const [update, setUpdate] = useState<UpdateInfo>({
    current: "",
    latest: "",
    update_available: false,
    checking: false,
    error: "",
    changelog: "",
  });
  const [updateRunning, setUpdateRunning] = useState(false);
  const [updateLog, setUpdateLog] = useState("");
  const [updateSucceeded, setUpdateSucceeded] = useState(false);
  const updateLogRef = useRef<HTMLPreElement>(null);
  const pollRef = useRef(false);

  const refreshData = async () => {
    try {
      const [stateRes, configRes] = await Promise.all([request("/api/state", { cache: "no-store" }), request("/api/config", { cache: "no-store" })]);
      setState(await stateRes.json());
      setConfig(await configRes.json());
    } catch {
      /* ignore polling errors */
    }
  };

  useEffect(() => {
    void refreshData();
  }, []);

  const loadUpdateLog = async () => {
    const body = (await request("/api/actions/log", { cache: "no-store" }).then((r) => r.json())) as LogInfo;
    setUpdateLog(body.log ?? "");
    setUpdateRunning(Boolean(body.running));
  };

  const pollUpdate = (attempt: number) => {
    if (!pollRef.current) return;
    request("/api/actions/log", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: LogInfo) => {
        setUpdateLog(body.log ?? "");
        setUpdateRunning(Boolean(body.running));
        if (body.running) {
          window.setTimeout(() => pollUpdate(attempt + 1), 1000);
          return;
        }
        pollRef.current = false;
        setUpdateRunning(false);
        if (/Установка завершена|установка завершена|Finished/.test(body.log || "")) {
          setUpdateSucceeded(true);
        }
        void refreshData();
      })
      .catch(() => {
        pollRef.current = false;
        setUpdateRunning(false);
      });
  };

  const checkUpdate = async () => {
    setUpdate((prev) => ({ ...prev, checking: true, error: "" }));
    try {
      const body = (await request("/api/update/check", { cache: "no-store" }).then((r) => r.json())) as UpdateInfo;
      setUpdate({
        current: body.current,
        latest: body.latest,
        update_available: Boolean(body.update_available),
        checking: false,
        error: body.error || "",
        changelog: body.changelog || "",
      });
    } catch (err) {
      setUpdate((prev) => ({ ...prev, checking: false, error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const runUpdate = async () => {
    try {
      await request("/api/actions/install", { method: "POST" });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
    setUpdateLog("");
    setUpdateSucceeded(false);
    pollRef.current = true;
    setUpdateRunning(true);
    void loadUpdateLog();
    window.setTimeout(() => pollUpdate(0), 500);
  };

  const scrollToBottom = () => {
    if (updateLogRef.current) updateLogRef.current.scrollTop = updateLogRef.current.scrollHeight;
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  };

  const logout = async () => {
    setLogoutBtnBusy(true);
    try {
      await request("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    setLogoutBtnBusy(false);
    window.dispatchEvent(new Event("snolc-auth-required"));
  };

  const statusValue = (
    <span className={state.running ? "text-emerald-400" : "text-red-400"}>
      {state.running ? "запущен" : "остановлен"}
    </span>
  );

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-background/95">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">SNOLC Web</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <HeaderMetric label="Версия" value={state.installed_version || "..."} />
            <HeaderMetric label="Статус" value={statusValue} />
            <HeaderMetric label="Порт" value={state.config_path ? String(state.config_path.split(":")[1] ?? "") : "..."} />
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80 disabled:opacity-60"
              onClick={() => void refreshData()}
            >
              <RefreshCw className="h-4 w-4" />
              Обновить
            </button>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80 disabled:opacity-60"
              onClick={logout}
              disabled={logoutBtnBusy}
            >
              <LogOut className="h-4 w-4" />
              Выйти
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6">
        <section className="grid gap-3 md:grid-cols-3">
          <StatCard icon={<Server className="h-4 w-4" />} label="Версия snolc" value={state.installed_version || "..."} />
          <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="Статус сервиса" value={statusValue} />
          <StatCard icon={<User className="h-4 w-4" />} label="PID" value={state.pid ? String(state.pid) : "…"} />
        </section>

        <section className="mt-4 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-normal">Статус сервиса snolc</h2>
            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80 disabled:opacity-60"
                onClick={() => void request("/api/actions/restart", { method: "POST" }).then(() => void refreshData())}
              >
                <RotateCw className="h-4 w-4" />
                Перезапустить
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80 disabled:opacity-60"
                onClick={() => void request("/api/actions/stop", { method: "POST" }).then(() => void refreshData())}
              >
                <Download className="h-4 w-4 rotate-180" />
                Остановить
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80 disabled:opacity-60"
                onClick={() => void request("/api/actions/start", { method: "POST" }).then(() => void refreshData())}
              >
                <ArrowUpFromLine className="h-4 w-4" />
                Запустить
              </button>
            </div>
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            Лог работы сервиса: <span className="text-foreground">{state.log_path || "…"}</span>
          </div>
        </section>

        <section className="mt-4 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-normal">Установка сервиса snolc</h2>
            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80 disabled:opacity-60"
                onClick={() => void request("/api/actions/install", { method: "POST" }).then(() => {
                  setShowInstallLog(true);
                  void loadUpdateLog();
                })}
              >
                <Download className="h-4 w-4" />
                Установить
              </button>
              {showInstallLog && (
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80"
                  onClick={() => setShowInstallLog((v) => !v)}
                >
                  <Terminal className="h-4 w-4" />
                  {showInstallLog ? "Скрыть лог" : "Показать лог"}
                </button>
              )}
            </div>
          </div>
          {showInstallLog && (
            <pre
              ref={installLogRef}
              className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-black p-3 font-mono text-[11px] leading-relaxed text-slate-300"
            >
              {updateLog || "запуск…"}
            </pre>
          )}
        </section>

        <section className="mt-4 rounded-lg border border-border bg-card p-4">
          <h2 className="text-lg font-semibold tracking-normal">Обновление snolc</h2>
          <div className="mt-2 text-sm text-muted-foreground">
            Установленная версия: <span className="text-foreground">{update.current || "…"}</span> · Доступная версия:{" "}
            <span className="text-foreground">{update.update_available ? update.latest : "—"}</span>
          </div>
          {update.error && <div className="mt-2 text-xs text-red-500">{update.error}</div>}
          {update.changelog && (
            <div className="mt-3 border-t border-border pt-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Изменения в версии {update.latest}</div>
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs text-muted-foreground">
                {update.changelog}
              </pre>
            </div>
          )}
          <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
            <button
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80 disabled:opacity-60"
              onClick={() => void checkUpdate()}
              disabled={update.checking}
            >
              <RefreshCw className={`h-4 w-4 ${update.checking ? "animate-spin" : ""}`} />
              {update.checking ? "Проверка..." : "Проверить обновление"}
            </button>
            {update.update_available && (
              <button
                className="relative inline-flex h-9 items-center justify-center gap-2 overflow-hidden rounded-md bg-primary px-3 text-sm font-medium text-black hover:bg-primary/90 disabled:opacity-60"
                disabled={updateRunning}
                onClick={() => void runUpdate()}
              >
                <span className="relative z-10 inline-flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  {updateRunning ? "Обновление…" : `Обновить до ${update.latest}`}
                </span>
                {updateSucceeded && (
                  <span className="pointer-events-none absolute inset-y-0 right-0 bg-white/20 transition-all" style={{ width: "100%" }} />
                )}
              </button>
            )}
            {updateSucceeded && (
              <button
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-black hover:bg-primary/90"
                onClick={() => window.location.reload()}
              >
                <RotateCw className="h-4 w-4" />
                Перезагрузить панель
              </button>
            )}
          </div>
        </section>

        <section className="mt-4 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-normal">Файл конфигурации snolc ({config.path || "…"})</h2>
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80" onClick={() => setShowLog(true)}>
              <FileText className="h-4 w-4" />
              Посмотреть
            </button>
          </div>
          <textarea
            className="mt-3 min-h-[30rem] font-mono text-[12px] rounded-md border border-border bg-background p-3 outline-none focus:border-primary"
            value={config.content}
            onChange={(e) => setConfig((c) => ({ ...c, content: e.target.value }))}
            spellCheck={false}
            placeholder={config.exists ? "" : "Файл не создан; сохраните, чтобы создать"}
          />
          <div className="mt-3 flex justify-end">
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-black hover:bg-primary/90 disabled:opacity-60"
              onClick={async () => {
                try {
                  await request("/api/config", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ content: config.content }),
                  });
                  setNotice("Сохранено и проверено через snolc validate");
                  await refreshData();
                } catch (err) {
                  setNotice(err instanceof Error ? err.message : String(err));
                }
              }}
            >
              <Save className="h-4 w-4" />
              Сохранить и проверить
            </button>
          </div>
        </section>

        <section className="mt-4 rounded-lg border border-border bg-card p-4">
          <h2 className="text-lg font-semibold tracking-normal">Системный лог (snolc run)</h2>
          <pre
            ref={logRef}
            className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-black p-3 font-mono text-[11px] leading-relaxed text-slate-300"
          >
            {state.log_path ? "…" : "Лог не найден или пуст"}
          </pre>
        </section>

        {notice && (
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {notice}
          </div>
        )}
      </main>

      <Modal title="Файл конфигурации snolc" onClose={() => setShowLog(false)}>
        <div className="p-5">
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 font-mono text-xs text-muted-foreground">
            {config.content || "Файл пуст"}
          </pre>
          <div className="mt-5 flex justify-end gap-2">
            <button className="h-9 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80" onClick={() => setShowLog(false)}>
              Закрыть
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
