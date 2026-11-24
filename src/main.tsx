import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
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
  StopCircle,
  Terminal,
  XCircle,
  PlayCircle,
} from "lucide-react";
import "./index.css";

type NavKey = "status" | "system" | "services" | "admin";

type AuthMe = { user?: string; setup_required?: boolean };
type StateInfo = {
  installed_version?: string;
  running?: boolean;
  pid?: number | null;
  log_path?: string;
  config_path?: string;
};
type ConfigInfo = { path?: string; content?: string; exists?: boolean };
type LogInfo = { running?: string; progress?: number; log?: string };
type UpdateInfo = {
  current?: string;
  latest?: string;
  update_available?: boolean;
  checking?: boolean;
  error?: string;
  changelog?: string;
};
type PasswordForm = { current: string; next: string; repeat: string };

const NAV_ITEMS: { key: NavKey; icon: any; label: string }[] = [
  { key: "status", icon: Server, label: "Статус" },
  { key: "system", icon: FileText, label: "Система" },
  { key: "services", icon: Terminal, label: "Сервисы" },
  { key: "admin", icon: Settings, label: "Администрирование" },
];

function request(path: string, options?: RequestInit) {
  return fetch(path, options).then(async (res) => {
    if (!res.ok) {
      if (res.status === 401) window.dispatchEvent(new Event("snolc-auth-required"));
      throw new Error((await res.text()).trim() || res.statusText);
    }
    return res;
  });
}

function StatCard({ icon, label, value, tone = "auto" }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: "ok" | "error" | "auto" }) {
  const textClass = tone === "ok" ? "text-emerald-400" : tone === "error" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-2 text-2xl font-semibold tracking-normal ${textClass}`}>{value}</div>
    </div>
  );
}

function Section(props: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-normal text-foreground">{props.title}</h2>
          {props.subtitle && <div className="text-sm text-muted-foreground">{props.subtitle}</div>}
        </div>
        {props.actions && <div className="flex flex-wrap gap-2">{props.actions}</div>}
      </div>
      {props.children}
    </section>
  );
}

function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "emerald" | "destructive" | "amber" }) {
  const classes = {
    muted: "bg-muted text-muted-foreground",
    emerald: "bg-emerald-500/15 text-emerald-300",
    destructive: "bg-destructive/20 text-destructive",
    amber: "bg-amber-500/15 text-amber-300",
  }[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium ${classes}`}>{children}</span>;
}

function Btn({ children, icon, onClick, disabled, variant = "primary", className = "" }: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
}) {
  const base = "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors disabled:opacity-60";
  const styles =
    variant === "primary"
      ? "bg-primary text-zinc-900 hover:bg-primary/90"
      : variant === "danger"
        ? "bg-destructive/15 text-destructive hover:bg-destructive/25"
        : "border border-border bg-muted text-foreground hover:bg-muted/80";
  return (
    <button className={`${base} ${styles} ${className}`} onClick={onClick} disabled={disabled}>
      {icon}
      {children}
    </button>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-3xl overflow-auto rounded-lg border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
          <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted hover:bg-muted/80" onClick={onClose} aria-label="Закрыть">
            <XCircle className="h-4 w-4" />
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
    <div className="grid min-h-screen place-items-center bg-canvas px-5">
      <form className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-panel p-6" onSubmit={submit}>
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-primary/15 text-primary">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-normal">SNOLC Web</h1>
            <div className="text-sm text-muted-foreground">{setupRequired ? "Первичная настройка" : "Вход в панель"}</div>
          </div>
        </div>
        <label className="grid gap-2 text-sm text-muted-foreground">
          Логин
          <input className="h-10 rounded-md border border-border bg-canvas px-3 text-foreground outline-none focus:border-primary" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" />
        </label>
        <label className="grid gap-2 text-sm text-muted-foreground">
          Пароль
          <input className="h-10 rounded-md border border-border bg-canvas px-3 text-foreground outline-none focus:border-primary" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={setupRequired ? "new-password" : "current-password"} />
        </label>
        {setupRequired && (
          <label className="grid gap-2 text-sm text-muted-foreground">
            Повтор пароля
            <input className="h-10 rounded-md border border-border bg-canvas px-3 text-foreground outline-none focus:border-primary" type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" />
          </label>
        )}
        {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        <Btn type="submit" disabled={busy} className="w-full justify-center">
          <Lock className="h-4 w-4" />
          {setupRequired ? "Сохранить пароль" : "Войти"}
        </Btn>
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
      setAuthenticated(!body.setup_required);
    } catch {
      setAuthenticated(false);
    }
  };

  useEffect(() => {
    void checkAuth();
  }, []);

  useEffect(() => {
    const handler = () => void checkAuth();
    window.addEventListener("snolc-auth-required", handler);
    return () => window.removeEventListener("snolc-auth-required", handler);
  }, []);

  if (!authenticated) return <LoginView setupRequired={setupRequired} onReady={() => void checkAuth()} />;
  return (
    <Panel user={user} onNotice={setNotice} onLogout={() => void checkAuth()} />
  );
}

function Panel({ user, onNotice, onLogout }: { user: string; onNotice: (m: string) => void; onLogout: () => void }) {
  const [nav, setNav] = useState<NavKey>("status");
  const [state, setState] = useState<StateInfo>({});
  const [config, setConfig] = useState<ConfigInfo>({});
  const [update, setUpdate] = useState<UpdateInfo>({});
  const [updateRunning, setUpdateRunning] = useState(false);
  const [updateSucceeded, setUpdateSucceeded] = useState(false);
  const [installRunning, setInstallRunning] = useState(false);
  const [serviceBusy, setServiceBusy] = useState(false);
  const pollRef = useRef(false);

  const refreshState = async () => {
    try {
      const res = await request("/api/state", { cache: "no-store" });
      setState(await res.json());
    } catch {
      /* ignore */
    }
  };

  const loadUpdateLog = async () => {
    const body = (await request("/api/actions/log", { cache: "no-store" }).then((r) => r.json())) as LogInfo;
    return body;
  };

  const checkUpdate = async () => {
    try {
      const body = (await request("/api/update/check", { cache: "no-store" }).then((r) => r.json())) as UpdateInfo;
      setUpdate(body);
    } catch (err) {
      onNotice(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void refreshState();
    void checkUpdate();
    const timer = window.setInterval(() => {
      void refreshState();
      void checkUpdate();
    }, 4000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="flex min-h-screen bg-canvas text-foreground">
      {/* ---- sidebar ---- */}
      <aside className="fixed inset-y-0 left-0 z-40 w-56 border-r border-border bg-panel">
        <div className="flex h-16 items-center gap-3 border-b border-border px-5">
          <span className="text-xl font-semibold tracking-wider text-foreground">SNOLC</span>
          <span className="text-sm text-muted-foreground">Web</span>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const active = nav === item.key;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors ${
                  active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                onClick={() => setNav(item.key)}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-border p-4 text-sm text-muted-foreground">
          <div className="font-medium text-foreground">{user}</div>
          <Btn variant="danger" className="mt-2 w-full justify-center" onClick={onLogout} disabled={serviceBusy}>
            <LogOut className="h-4 w-4" />
            Выйти
          </Btn>
        </div>
      </aside>

      {/* ---- main ---- */}
      <main className="ml-56 flex-1 px-5 py-6">
        {nav === "status" && <StatusPanel state={state} update={update} setUpdate={setUpdate} checkUpdate={checkUpdate} onNotice={onNotice} />}
        {nav === "system" && <ConfigPanel onNotice={onNotice} refreshState={refreshState} />}
        {nav === "services" && <ServicesPanel />}
        {nav === "admin" && <AdminPanel setUpdate={setUpdate} updateSucceeded={updateSucceeded} />}
      </main>
      {notice && <Notice message={notice} />}
    </div>
  );
}

function Notice({ message }: { message: string }) {
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive shadow-lg">
      {message}
    </div>
  );
}

function StatusPanel({
  state,
  update,
  setUpdate,
  checkUpdate,
  onNotice,
}: {
  state: StateInfo;
  update: UpdateInfo;
  setUpdate: React.Dispatch<React.SetStateAction<UpdateInfo>>;
  checkUpdate: () => Promise<void>;
  onNotice: (m: string) => void;
}) {
  return (
    <>
      <Section title="Статус сервиса" subtitle="Текущее состояние процесса snolc">
        <div className="grid gap-3 md:grid-cols-3">
          <StatCard icon={<Server className="h-4 w-4 text-primary" />} label="Версия snolc" value={state.installed_version || "…"} />
          <StatCard
            icon={state.running ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-destructive" />}
            label="Статус"
            value={state.running ? "Работает" : "Остановлен"}
          />
          <StatCard icon={<PlayCircle className="h-4 w-4" />} label="PID" value={state.pid ? String(state.pid) : "…"} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn icon={<RotateCw />} onClick={() => window.location.reload()}>Перезагрузить страницу</Btn>
        </div>
      </Section>

      <Section title="Установка и обновление snolc" subtitle="Панель определяет новые версии с GitHub" actions={
        <Btn icon={<RefreshCw />} disabled={update.checking} onClick={() => void checkUpdate()}>
          {update.checking ? "Проверка…" : "Проверить обновление"}
        </Btn>
      }>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              Установленная версия: <span className="text-foreground">{update.current || state.installed_version || "…"}</span>
            </div>
            {update.update_available && (
              <Badge tone="emerald">Доступно обновление</Badge>
            )}
            {update.error && <Badge tone="destructive">{update.error}</Badge>}
          </div>
          {update.changelog && (
            <pre className="max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">{update.changelog}</pre>
          )}
        </div>
      </Section>
    </>
  );
}

function ConfigPanel({ onNotice, refreshState }: { onNotice: (m: string) => void; refreshState: () => Promise<void> }) {
  const [content, setContent] = useState<string>("");
  const [path, setPath] = useState("");
  const [exists, setExists] = useState(true);

  useEffect(() => {
    request("/api/config", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: ConfigInfo) => {
        setPath(body.path ?? "");
        setContent(body.content ?? "");
        setExists(body.exists !== false);
      })
      .catch((err) => onNotice(err.message));
  }, []);

  const save = async () => {
    try {
      await request("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      await refreshState();
    } catch (err) {
      onNotice(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Section
      title="Файл конфигурации snolc"
      subtitle={path ? `${path}${exists ? "" : " (новый файл)"}` : "…"}
      actions={
        <Btn variant="primary" onClick={() => void save()}>
          <Save className="h-4 w-4" />
          Сохранить
        </Btn>
      }
    >
      <textarea
        className="min-h-[34rem] w-full rounded-md border border-border bg-canvas p-4 font-mono text-[13px] text-foreground outline-none focus:border-primary"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        spellCheck={false}
      />
    </Section>
  );
}

function ServicesPanel() {
  const [logPath, setLogPath] = useState("");
  const [log, setLog] = useState("");
  const [running, setRunning] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      request("/api/state", { cache: "no-store" })
        .then((r) => r.json())
        .then((s: StateInfo) => {
          if (!cancelled) {
            setLogPath(s.log_path ?? "");
          }
        })
        .catch(() => {});
      request("/api/actions/log", { cache: "no-store" })
        .then((r) => r.json())
        .then((body: LogInfo) => {
          if (!cancelled) {
            setLog(body.log ?? "");
            setRunning(Boolean(body.running));
          }
        })
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(load, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <Section
      title="Системный лог snolc"
      subtitle={logPath}
      actions={running === false ? <Badge tone="destructive">остановлен</Badge> : <Badge tone="emerald">работает</Badge>}
    >
      <div className="relative mt-3 h-[45rem] overflow-hidden rounded-md border border-border bg-black">
        <div className="max-h-full overflow-auto p-3 font-mono text-[11px] leading-relaxed text-slate-300">
          {log || "Лог пока недоступен или пуст"}
        </div>
      </div>
    </Section>
  );
}

function AdminPanel({ updateSucceeded }: { updateSucceeded: boolean }) {
  const [form, setForm] = useState<PasswordForm>({ current: "", next: "", repeat: "" });
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const change = async () => {
    setBusy(true);
    try {
      await request("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: form.current, new_password: form.next, new_password_repeat: form.repeat }),
      });
      setDone(true);
      setForm({ current: "", next: "", repeat: "" });
    } catch {
      /* ignore */
    }
    setBusy(false);
  };

  return (
    <>
      <Section title="Пароль администратора">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-2 text-sm text-muted-foreground">
              Текущий пароль
              <input
                className="h-10 rounded-md border border-border bg-canvas px-3 text-foreground outline-none focus:border-primary"
                type="password"
                value={form.current}
                onChange={(e) => setForm((f) => ({ ...f, current: e.target.value }))}
                autoComplete="current-password"
              />
            </label>
            <label className="grid gap-2 text-sm text-muted-foreground">
              Новый пароль
              <input
                className="h-10 rounded-md border border-border bg-canvas px-3 text-foreground outline-none focus:border-primary"
                type="password"
                value={form.next}
                onChange={(e) => setForm((f) => ({ ...f, next: e.target.value }))}
                autoComplete="new-password"
              />
            </label>
            <label className="grid gap-2 text-sm text-muted-foreground">
              Повтор пароля
              <input
                className="h-10 rounded-md border border-border bg-canvas px-3 text-foreground outline-none focus:border-primary"
                type="password"
                value={form.repeat}
                onChange={(e) => setForm((f) => ({ ...f, repeat: e.target.value }))}
                autoComplete="new-password"
              />
            </label>
          </div>
          <div className="flex items-center gap-4">
            <Btn onClick={() => void change()} disabled={busy}>
              <KeyRound className="h-4 w-4" />
              {busy ? "Сохраняю…" : "Сохранить новый пароль"}
            </Btn>
            {done && <Badge tone="emerald">Пароль сохранён</Badge>}
          </div>
        </div>
      </Section>
      {updateSucceeded && (
        <Section title="После обновления" subtitle="Рекомендуем обновить страницу">
          <Btn icon={<RotateCw />} onClick={() => window.location.reload()}>Перезагрузить страницу</Btn>
        </Section>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
