import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, Download, Lock, LogOut, RefreshCw, RotateCw, Save, Server, Settings, ShieldOff, Terminal, Upload, Power } from "lucide-react";
import "./index.css";

type Section = "status" | "config" | "system" | "password";

type AuthMe = { user: string; setup_required: boolean };
type StateInfo = { installed_version: string; latest_version: string; running: boolean; pid: number | null; log_path: string; config_path: string };
type ConfigInfo = { path: string; content: string; exists: boolean };
type LogInfo = { running: boolean; progress: number; log: string };
type VersionInfo = { current: string; latest: string; update_available: boolean; checking: boolean; changelog: string; error: string };

async function request(path: string, options?: RequestInit) {
  const res = await fetch(path, options);
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("snolc-auth-required"));
    throw new Error((await res.text()).trim() || res.statusText);
  }
  return res;
}

function AuthForm({ setupRequired, onReady }: { setupRequired: boolean; onReady: () => void }) {
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
      <form className="grid w-full max-w-sm gap-4 rounded-lg border border-border bg-card p-6" onSubmit={submit}>
        <div className="grid h-12 w-12 place-items-center rounded-md bg-primary/15 text-primary">
          <Lock className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold tracking-normal">SNOLC Web</h1>
        <div className="text-sm text-muted-foreground">{setupRequired ? "Первичная настройка" : "Вход в панель"}</div>
        <label className="grid gap-2 text-sm text-muted-foreground">
          Логин
          <input className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" />
        </label>
        <label className="grid gap-2 text-sm text-muted-foreground">
          Пароль
          <input className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={setupRequired ? "new-password" : "current-password"} />
        </label>
        {setupRequired && (
          <label className="grid gap-2 text-sm text-muted-foreground">
            Повтор пароля
            <input className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary" type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" />
          </label>
        )}
        {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-black hover:bg-primary/90 disabled:opacity-60" disabled={busy}>
          <Lock className="h-4 w-4" />
          {setupRequired ? "Сохранить пароль" : "Войти"}
        </button>
      </form>
    </div>
  );
}

function Panel({ user, onLogout }: { user: string; onLogout: () => void }) {
  const [section, setSection] = useState<Section>("status");
  const [state, setState] = useState<StateInfo>({ installed_version: "?", latest_version: "", running: false, pid: null, log_path: "", config_path: "" });
  const [config, setConfig] = useState<ConfigInfo>({ path: "", content: "", exists: true });
  const [error, setError] = useState("");

  const loadState = async () => {
    const body = (await request("/api/state", { cache: "no-store" })).json();
    const st = body as StateInfo;
    setState(st);
    if (!st.config_path) return;
  };

  const loadConfig = async () => {
    const body = (await request("/api/config", { cache: "no-store" })).json();
    setConfig(body as ConfigInfo);
  };

  useEffect(() => {
    loadState().catch((e) => setError(e.message));
    loadConfig().catch((e) => setError(e.message));
  }, []);

  const statusInfo = () => {
    const lines: string[] = [];
    if (state.installed_version) lines.push(`Установленная версия (snolc version): ${state.installed_version}`);
    if (state.config_path) lines.push(`Конфиг: ${state.config_path}`);
    if (state.log_path) lines.push(`Лог работы (snolc run): ${state.log_path}`);
    lines.push(`Статус сервиса: ${state.running ? "запущен" : "остановлен"}${state.pid ? ` (pid ${state.pid})` : ""}`);
    return lines;
  };

  return (
    <div className="grid min-h-screen grid-cols-[200px_1fr] bg-background text-foreground">
      <nav className="flex flex-col gap-1 border-r border-border p-4">
        <div className="mb-4 text-xl font-semibold tracking-normal">SNOLC Web</div>
        {(["status", "config", "system", "password"] as const).map((s) => {
          const labels: Record<Section, string> = { status: "Статус", config: "Конфиг", system: "Система", password: "Пароль" };
          const icons: Record<Section, any> = { status: Server, config: Terminal, system: ArrowUpFromLine, password: Settings };
          const Icon = icons[s];
          return (
            <button key={s} onClick={() => setSection(s)} className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm ${section === s ? "bg-accent text-accent-foreground" : "hover:bg-accent"}`}>
              <Icon className="h-4 w-4" />
              {labels[s]}
            </button>
          );
        })}
        <div className="mt-auto flex flex-col gap-2">
          <button onClick={() => { request("/api/auth/logout", { method: "POST" }).then(onLogout).catch((e) => setError(e.message)); }} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground hover:bg-accent">
            <LogOut className="h-4 w-4" />
            Выход ({user})
          </button>
        </div>
      </nav>
      <main className="flex flex-col gap-4 p-6">
        {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

        {section === "status" && <StatusPanel state={state} reload={loadState} />}
        {section === "config" && <ConfigPanel config={config} reload={loadConfig} />}
        {section === "system" && <SystemPanel state={state} />}
        {section === "password" && <PasswordPanel />}
      </main>
    </div>
  );
}

function StatusPanel({ state, reload }: { state: StateInfo; reload: () => void }) {
  const [updateState, setUpdateState] = useState<VersionInfo>({ current: "", latest: "", update_available: false, checking: false, changelog: "", error: "" });
  const [updateRunning, setUpdateRunning] = useState(false);
  const [updateLog, setUpdateLog] = useState("");
  const [showUpdateLog, setShowUpdateLog] = useState(true);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const updateLogRef = useRef<HTMLPreElement>(null);
  const pollRef = useRef(false);

  const scrollToBottom = () => { if (updateLogRef.current) updateLogRef.current.scrollTop = updateLogRef.current.scrollHeight; };

  const checkUpdate = async () => {
    setUpdateState((prev) => ({ ...prev, checking: true, error: "" }));
    try {
      const body = (await request("/api/update/check", { cache: "no-store" })).json();
      setUpdateState({
        current: (body as VersionInfo).current,
        latest: (body as VersionInfo).latest,
        update_available: Boolean((body as VersionInfo).update_available),
        changelog: (body as VersionInfo).changelog ?? "",
        error: "",
      });
    } catch (err) {
      setUpdateState((prev) => ({ ...prev, checking: false, error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setUpdateState((prev) => ({ ...prev, checking: false }));
    }
  };

  const loadUpdateLog = async () => {
    const body = (await request("/api/actions/log", { cache: "no-store" })).json();
    setUpdateLog((body as LogInfo).log ?? "");
    setUpdateRunning(Boolean((body as LogInfo).running));
    setUpdateProgress((body as LogInfo).progress ?? 0);
  };

  const pollUpdate = (attempt: number) => {
    if (!pollRef.current) return;
    request("/api/actions/log", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: LogInfo) => {
        setUpdateLog(body.log ?? "");
        setUpdateRunning(body.running);
        setUpdateProgress(body.progress ?? 0);
        scrollToBottom();
        if (body.running) {
          window.setTimeout(() => pollUpdate(attempt + 1), 1000);
          return;
        }
        pollRef.current = false;
        setUpdateRunning(false);
        if (/Установка завершена|установка завершена|Finished/.test(body.log || "")) {
          // reload state + version info
          reload();
          checkUpdate().catch(() => {});
        }
      })
      .catch(() => {
        pollRef.current = false;
        setUpdateRunning(false);
      });
  };

  const runInstall = async () => {
    setBusy(true);
    try {
      await request("/api/actions/install", { method: "POST" });
      setUpdateLog("");
      setUpdateProgress(0);
      pollRef.current = true;
      setUpdateRunning(true);
      loadUpdateLog().catch(() => {});
      window.setTimeout(() => pollUpdate(0), 500);
    } catch (err) {
      setUpdateLog((l) => l + "\n[начало…]");
      setBusy(false);
    }
  };

  useEffect(() => { checkUpdate().catch(() => {}); loadUpdateLog().catch(() => {}); }, []);

  return (
    <>
      <section className="rounded-md border border-border bg-card p-4">
        <div className="text-sm font-medium text-foreground">Статус сервиса snolc</div>
        <div className="mt-2 text-xs text-muted-foreground space-y-1">
          <div>Статус: <span className={state.running ? "text-emerald-600" : "text-red-600"}>{state.running ? "запущен" : "остановлен"}</span>{state.pid ? ` (pid ${state.pid})` : ""}</div>
          {state.installed_version && <div>Версия snolc: <span className="text-foreground">{state.installed_version}</span></div>}
        </div>
        <div className="mt-auto flex justify-end gap-2">
          <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80" onClick={() => request("/api/actions/restart", { method: "POST" }).then(() => setUpdateRunning(true))} disabled={busy}><RotateCw className="h-4 w-4" />Перезапустить</button>
          <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80" onClick={() => request("/api/actions/stop", { method: "POST" }).then(reload).catch(() => {})} disabled={busy}><Power className="h-4 w-4" />Остановить</button>
          <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80" onClick={() => request("/api/actions/start", { method: "POST" }).then(reload).catch(() => {})} disabled={busy}><ArrowUpFromLine className="h-4 w-4" />Запустить</button>
        </div>
      </section>

      <section className="rounded-md border border-border bg-card p-4">
        <div className="text-sm font-medium text-foreground">Установка сервиса snolc</div>
        <div className="text-xs text-muted-foreground mt-2 space-y-1">
          <div>Статус установки: <span className="text-foreground">{busy ? "выполняется…" : "готов"}</span></div>
        </div>
        <div className="mt-auto flex justify-end gap-2">
          <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80 disabled:opacity-60" onClick={runInstall} disabled={busy}><Download className="h-4 w-4" />Установить</button>
        </div>
        {updateRunning || updateLog ? <button className="mt-3 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowUpdateLog(v => !v)}>{showUpdateLog ? "Скрыть" : "Показать"} лог</button> : null}
        {showUpdateLog && (updateRunning || updateLog) && (
          <pre ref={updateLogRef} className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-black p-2 font-mono text-[11px] leading-relaxed text-slate-300">
            {updateLog || "запуск…"}
          </pre>
        )}
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-md bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${updateProgress}%` }} />
        </div>
      </section>

      <section className="rounded-md border border-border bg-card p-4">
        <div className="text-sm font-medium text-foreground">Обновление snolc</div>
        <div className="mt-2 text-xs text-muted-foreground space-y-1">
          <div>Установленная версия: <span className="text-foreground">{updateState.current || "…"}</span></div>
          <div>Доступная версия: <span className="text-foreground">{updateState.update_available ? updateState.latest : "—"}</span></div>
        </div>
        {updateState.error && <div className="mt-2 text-xs text-red-500">{updateState.error}</div>}
        {updateState.changelog && (
          <div className="mt-3 border-t border-border pt-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">Изменения в версии {updateState.latest}</div>
            <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs text-muted-foreground">{updateState.changelog}</pre>
          </div>
        )}
        <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
          <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80 disabled:opacity-60" onClick={checkUpdate} disabled={busy}><RefreshCw className="h-4 w-4" />{updateState.checking ? "…" : "Проверить обновление"}</button>
          {updateState.update_available && (
            <button className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-black hover:bg-primary/90 disabled:opacity-60" onClick={runInstall} disabled={busy}><Upload className="h-4 w-4" />Обновить сейчас</button>
          )}
        </div>
      </section>
    </>
  );
}

function ConfigPanel({ config, reload }: { config: ConfigInfo; reload: () => void }) {
  const [content, setContent] = useState(config.content);
  const [validating, setValidating] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => { setContent(config.content); setMessage(""); }, [config.content]);

  const save = async () => {
    setValidating(true);
    setMessage("");
    try {
      await request("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      setMessage("сохранено");
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setValidating(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
      <div className="text-sm font-medium text-foreground">Файл конфигурации snolc ({config.path || "…"})</div>
      {!config.exists && <div className="text-xs text-muted-foreground">Файл не создан до сохранения.</div>}
      {message && <div className="text-xs text-emerald-600">{message}</div>}
      <textarea className="min-h-[40rem] font-mono text-[12px] rounded-md border border-border bg-background p-3 outline-none focus:border-primary" value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} />
      <div className="flex justify-end gap-2">
        <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80 disabled:opacity-60" onClick={save} disabled={validating}><Save className="h-4 w-4" />{validating ? "Проверка…" : "Сохранить и проверить (snolc validate)"}</button>
      </div>
    </section>
  );
}

function SystemPanel({ state }: { state: StateInfo }) {
  const [log, setLog] = useState("");
  const [running, setRunning] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    request("/api/actions/log", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: LogInfo) => { if (!cancelled) { setLog(body.log ?? ""); setRunning(body.running); } })
      .catch(() => {});
    const timer = window.setInterval(() => {
      request("/api/actions/log", { cache: "no-store" })
        .then((res) => res.json())
        .then((body: LogInfo) => { if (!cancelled) { setLog(body.log ?? ""); setRunning(body.running); } })
        .catch(() => {});
    }, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  return (
    <section className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
      <div className="text-sm font-medium text-foreground">Лог запущенного snolc (snolc run)</div>
      <div className="text-xs text-muted-foreground">Статус сервиса: {state.running ? "запущен" : "остановлен"}{state.log_path ? ` · файл: ${state.log_path}` : ""}</div>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-black p-3 font-mono text-[11px] leading-relaxed text-slate-300">{log || "Лог не найден или пуст"}</pre>
    </section>
  );
}

function PasswordPanel() {
  const [form, setForm] = useState({ current: "", next: "", repeat: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const changePassword = async () => {
    setBusy(true);
    setError("");
    try {
      await request("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: form.current, new_password: form.next, new_password_repeat: form.repeat }),
      });
      setForm({ current: "", next: "", repeat: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
      <div className="text-sm font-medium text-foreground">Изменение пароля администратора</div>
      {error && <div className="text-xs text-destructive">{error}</div>}
      <label className="grid gap-2 text-sm text-muted-foreground">Текущий пароль<input className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary" type="password" value={form.current} onChange={(e) => setForm((f) => ({ ...f, current: e.target.value }))} autoComplete="current-password" /></label>
      <label className="grid gap-2 text-sm text-muted-foreground">Новый пароль<input className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary" type="password" value={form.next} onChange={(e) => setForm((f) => ({ ...f, next: e.target.value }))} autoComplete="new-password" /></label>
      <label className="grid gap-2 text-sm text-muted-foreground">Повтор пароля<input className="h-10 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary" type="password" value={form.repeat} onChange={(e) => setForm((f) => ({ ...f, repeat: e.target.value }))} autoComplete="new-password" /></label>
      <div className="mt-auto flex justify-end">
        <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-muted px-3 text-sm hover:bg-muted/80 disabled:opacity-60" onClick={changePassword} disabled={busy}><Lock className="h-4 w-4" />Сохранить новый пароль</button>
      </div>
    </section>
  );
}

function Main() {
  const [authenticated, setAuthenticated] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [user, setUser] = useState("");
  const [authError, setAuthError] = useState("");

  const checkAuth = async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as AuthMe;
      setUser(body.user);
      setSetupRequired(Boolean(body.setup_required));
      setAuthenticated(true);
    } catch {
      setAuthenticated(false);
    }
  };

  useEffect(() => { checkAuth(); }, []);
  useEffect(() => {
    const handler = () => checkAuth();
    window.addEventListener("snolc-auth-required", handler);
    return () => window.removeEventListener("snolc-auth-required", handler);
  }, []);

  if (authenticated) return <Panel user={user} onLogout={() => checkAuth()} />;
  return <AuthForm setupRequired={setupRequired} onReady={() => { checkAuth().catch((e) => setAuthError(e.message)); }} />;
}

createRoot(document.getElementById("root")!).render(<Main />);
