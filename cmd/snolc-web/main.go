// snolc-web — веб-панель и менеджер сервиса snolc.
package main

import (
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

//go:embed web/dist
var adminAssets embed.FS

const (
	adminCookie   = "snolc_web_session"
	snolcBinary   = "snolc"
	defaultAddr   = "0.0.0.0"
	defaultDir    = "/etc/snolc-web"
	snolcRepoURL  = "https://github.com/owenewans/snolc"
	githubAPIURL  = "https://api.github.com/repos/owenewans/snolc/releases/latest"
)

var (
	adminConfigPath = "/etc/snolc-web/config.json"
	sessionsMu      sync.Mutex
	sessions        = map[string]time.Time{}
	installMu       sync.Mutex
	installRunning  bool
	updateMu        sync.Mutex
	updateRunning   bool
)

type panelConfig struct {
	Port      int    `json:"port"`
	Addr      string `json:"addr,omitempty"`
	AdminPath string `json:"admin_path,omitempty"`
	Dir       string `json:"dir,omitempty"`
}

type updateCheckResponse struct {
	Current         string `json:"current"`
	Latest          string `json:"latest"`
	UpdateAvailable bool   `json:"update_available"`
	Changelog       string `json:"changelog"`
	Error           string `json:"error,omitempty"`
}

type stateResponse struct {
	InstalledVersion string `json:"installed_version"`
	LatestVersion    string `json:"latest_version,omitempty"`
	Running          bool   `json:"running"`
	PID              int    `json:"pid"`
	LogPath          string `json:"log_path"`
	ConfigPath       string `json:"config_path"`
}

type configResponse struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Exists  bool   `json:"exists"`
}

type logResponse struct {
	Running  string `json:"running"`
	Progress int    `json:"progress"`
	Log      string `json:"log"`
}

func main() {
	var configPath string
	flag.StringVar(&configPath, "config", adminConfigPath, "path to panel config JSON")
	flag.Parse()
	if configPath != "" {
		adminConfigPath = configPath
	}
	if err := run(adminConfigPath); err != nil {
		log.Fatal(err)
	}
}

func run(configPath string) error {
	cfg, err := loadPanelConfig(configPath)
	if err != nil {
		return err
	}
	if cfg.Port <= 0 {
		return errors.New("port is required in panel config")
	}
	if cfg.Addr == "" {
		cfg.Addr = defaultAddr
	}
	if cfg.Dir == "" {
		cfg.Dir = defaultDir
	}
	if err := os.MkdirAll(cfg.Dir, 0o755); err != nil {
		return err
	}

	admin, err := adminFileServer()
	if err != nil {
		return err
	}
	handler := http.NewServeMux()
	adminRoute := adminPath(cfg)
	handler.Handle(adminRoute, adminPageHandler(cfg, admin))
	if adminRoute != "/admin" {
		handler.Handle("/admin", adminPageHandler(cfg, admin))
	}
	handler.Handle("/assets/", admin)
	handler.Handle("/api/auth/setup", http.HandlerFunc(setupHandler(cfg)))
	handler.Handle("/api/auth/login", http.HandlerFunc(loginHandler(cfg)))
	handler.Handle("/api/auth/logout", adminAuth(cfg)(http.HandlerFunc(logoutHandler)))
	handler.Handle("/api/auth/me", http.HandlerFunc(authMeHandler(cfg)))
	handler.Handle("/api/auth/password", adminAuth(cfg)(http.HandlerFunc(changePasswordHandler(cfg))))
	handler.Handle("/api/state", adminAuth(cfg)(http.HandlerFunc(stateHandler(cfg))))
	handler.Handle("/api/config", adminAuth(cfg)(http.HandlerFunc(configHandler(cfg))))
	handler.Handle("/api/update/check", adminAuth(cfg)(http.HandlerFunc(updateCheckHandler)))
	handler.Handle("/api/actions/start", adminAuth(cfg)(http.HandlerFunc(startHandler(cfg))))
	handler.Handle("/api/actions/stop", adminAuth(cfg)(http.HandlerFunc(stopHandler(cfg))))
	handler.Handle("/api/actions/restart", adminAuth(cfg)(http.HandlerFunc(restartHandler(cfg))))
	handler.Handle("/api/actions/install", adminAuth(cfg)(http.HandlerFunc(installHandler(cfg))))
	handler.Handle("/api/actions/log", adminAuth(cfg)(http.HandlerFunc(actionsLogHandler(cfg))))

	server := &http.Server{
		Addr:              net.JoinHostPort(cfg.Addr, strconv.Itoa(cfg.Port)),
		Handler:           securityHeaders(handler),
		ReadHeaderTimeout: 5 * time.Second,
	}
	log.Printf("SNOLC Web panel listening on https://%s%s", server.Addr, adminPath(cfg))
	return server.ListenAndServeTLS(tlsCertPath(cfg), tlsKeyPath(cfg))
}

func loadPanelConfig(path string) (panelConfig, error) {
	var cfg panelConfig
	if path == "" {
		return cfg, errors.New("-config is required")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return cfg, err
		}
		cfg.Port = 0
		if port := os.Getenv("SNOLC_WEB_PORT"); port != "" {
			if n, err := strconv.Atoi(port); err == nil {
				cfg.Port = n
			}
		}
		cfg.Addr = envDefault("SNOLC_WEB_ADDR", defaultAddr)
		cfg.Dir = envDefault("SNOLC_WEB_DIR", defaultDir)
		cfg.AdminPath = envDefault("SNOLC_WEB_ADMIN_PATH", "/admin")
		if err := os.MkdirAll(cfg.Dir, 0o755); err != nil {
			return cfg, err
		}
		return cfg, nil
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return cfg, err
	}
	if cfg.Addr == "" {
		cfg.Addr = envDefault("SNOLC_WEB_ADDR", defaultAddr)
	}
	if cfg.Dir == "" {
		cfg.Dir = envDefault("SNOLC_WEB_DIR", defaultDir)
	}
	if cfg.AdminPath == "" {
		cfg.AdminPath = "/admin"
	}
	return cfg, nil
}

func envDefault(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func adminPath(cfg panelConfig) string {
	if cfg.AdminPath == "" {
		return "/admin"
	}
	return strings.TrimSuffix(cfg.AdminPath, "/")
}

func adminFileServer() (http.Handler, error) {
	dist, err := fs.Sub(adminAssets, "web/dist")
	if err != nil {
		return nil, fmt.Errorf("load admin assets: %w", err)
	}
	return http.FileServer(http.FS(dist)), nil
}

func adminPageHandler(cfg panelConfig, files http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		r.URL.Path = "/"
		files.ServeHTTP(w, r)
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}

func writeJSONStatus(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'")
		next.ServeHTTP(w, r)
	})
}

// ---------------------------------------------------------------- auth

func adminCredentials(cfg panelConfig) (string, string) {
	user, pass := os.Getenv("SNOLC_WEB_USER"), os.Getenv("SNOLC_WEB_PASS")
	if values, err := readEnvFile(panelEnvPath(cfg)); err == nil {
		user = firstNonEmpty(values["SNOLC_WEB_USER"], user)
		pass = firstNonEmpty(values["SNOLC_WEB_PASS"], pass)
	}
	return user, pass
}

func readEnvFile(path string) (map[string]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	values := make(map[string]string)
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, "=") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		values[strings.TrimSpace(parts[0])] = strings.Trim(strings.TrimSpace(parts[1]), `"'`)
	}
	return values, nil
}

func panelEnvPath(cfg panelConfig) string {
	if path := strings.TrimSpace(os.Getenv("SNOLC_WEB_ENV_FILE")); path != "" {
		return path
	}
	if cfg.Dir != "" {
		return filepath.Join(cfg.Dir, "panel.env")
	}
	return defaultDir + "/panel.env"
}

func panelVersionPath(cfg panelConfig) string {
	if path := strings.TrimSpace(os.Getenv("SNOLC_WEB_VERSION_FILE")); path != "" {
		return path
	}
	if cfg.Dir != "" {
		return filepath.Join(cfg.Dir, "panel-version")
	}
	return defaultDir + "/panel-version"
}

func randomToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func sessionsCreate() (string, error) {
	token, err := randomToken()
	if err != nil {
		return "", err
	}
	sessionsMu.Lock()
	sessions[token] = time.Now().Add(24 * time.Hour)
	sessionsMu.Unlock()
	return token, nil
}

func sessionsValid(token string) bool {
	if token == "" {
		return false
	}
	sessionsMu.Lock()
	defer sessionsMu.Unlock()
	if until, ok := sessions[token]; ok {
		if time.Now().Before(until) {
			return true
		}
		delete(sessions, token)
	}
	return false
}

func sessionsClear() {
	sessionsMu.Lock()
	sessions = map[string]time.Time{}
	sessionsMu.Unlock()
}

func setSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     adminCookie,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		MaxAge:   86400,
	})
}

func adminAuth(cfg panelConfig) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, pass := adminCredentials(cfg)
			if user == "" || pass == "" {
				writeJSONStatus(w, http.StatusUnauthorized, map[string]any{"setup_required": true})
				return
			}
			if cookie, err := r.Cookie(adminCookie); err == nil && sessionsValid(cookie.Value) {
				next.ServeHTTP(w, r)
				return
			}
			if user2, pass2, ok := r.BasicAuth(); ok &&
				subtle.ConstantTimeCompare([]byte(user2), []byte(user)) == 1 &&
				subtle.ConstantTimeCompare([]byte(pass2), []byte(pass)) == 1 {
				next.ServeHTTP(w, r)
				return
			}
			writeJSONStatus(w, http.StatusUnauthorized, map[string]any{"setup_required": false})
		})
	}
}

func authMeHandler(cfg panelConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		user, pass := adminCredentials(cfg)
		if user == "" || pass == "" {
			writeJSON(w, map[string]any{"authenticated": false, "setup_required": true})
			return
		}
		if cookie, err := r.Cookie(adminCookie); err == nil && sessionsValid(cookie.Value) {
			writeJSON(w, map[string]any{"authenticated": true, "user": user})
			return
		}
		writeJSONStatus(w, http.StatusUnauthorized, map[string]any{"authenticated": false})
	}
}

func setupHandler(cfg panelConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			User     string `json:"user"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		user := strings.TrimSpace(req.User)
		password := strings.TrimSpace(req.Password)
		if user == "" || len(password) < 8 {
			http.Error(w, "user is required; password must contain at least 8 characters", http.StatusBadRequest)
			return
		}
		if pass := os.Getenv("SNOLC_WEB_PASS"); pass != "" {
			http.Error(w, "setup is already done", http.StatusConflict)
			return
		}
		if err := writePanelEnv(cfg, user, password); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		token, err := sessionsCreate()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		setSessionCookie(w, token)
		writeJSON(w, map[string]any{"authenticated": true, "user": user})
	}
}

func loginHandler(cfg panelConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			User     string `json:"user"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		user, pass := adminCredentials(cfg)
		if user == "" || pass == "" {
			writeJSONStatus(w, http.StatusConflict, map[string]any{"setup_required": true})
			return
		}
		if subtle.ConstantTimeCompare([]byte(req.User), []byte(user)) != 1 ||
			subtle.ConstantTimeCompare([]byte(req.Password), []byte(pass)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		token, err := sessionsCreate()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		setSessionCookie(w, token)
		writeJSON(w, map[string]any{"authenticated": true, "user": user})
	}
}

func logoutHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if cookie, err := r.Cookie(adminCookie); err == nil {
		sessionsMu.Lock()
		delete(sessions, cookie.Value)
		sessionsMu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: adminCookie, Value: "", Path: "/", MaxAge: -1})
	writeJSON(w, map[string]any{"authenticated": false})
}

func changePasswordHandler(cfg panelConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			Current  string `json:"current_password"`
			New      string `json:"new_password"`
			Repeated string `json:"new_password_repeat"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if req.Repeated == "" {
			req.Repeated = req.New
		}
		if req.New != req.Repeated {
			http.Error(w, "пароли не совпадают", http.StatusBadRequest)
			return
		}
		user, pass := adminCredentials(cfg)
		if subtle.ConstantTimeCompare([]byte(req.Current), []byte(pass)) != 1 {
			http.Error(w, "current password is invalid", http.StatusUnauthorized)
			return
		}
		if len(req.New) < 8 {
			http.Error(w, "new password must contain at least 8 characters", http.StatusBadRequest)
			return
		}
		if err := writePanelEnv(cfg, user, req.New); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		sessionsClear()
		writeJSON(w, map[string]any{"changed": true})
	}
}

func writePanelEnv(cfg panelConfig, user, pass string) error {
	data := fmt.Sprintf("SNOLC_WEB_USER=%s\nSNOLC_WEB_PASS=%s\n", shellQuote(user), shellQuote(pass))
	return os.WriteFile(panelEnvPath(cfg), []byte(data), 0o600)
}

func shellQuote(value string) string {
	if value == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(value, "'", `'"'"'`) + "'"
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// ---------------------------------------------------------------- state & config

func stateHandler(cfg panelConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		version := installedVersion()
		running, pid := snolcRunStatus(cfg)
		writeJSON(w, stateResponse{
			InstalledVersion: version,
			Running:          running,
			PID:              pid,
			LogPath:          filepath.Join(cfg.Dir, "run.log"),
			ConfigPath:       snolcConfigPath(cfg),
		})
	}
}

func configHandler(cfg panelConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			path := snolcConfigPath(cfg)
			data, err := os.ReadFile(path)
			exists := err == nil
			writeJSON(w, configResponse{Path: path, Content: string(data), Exists: exists})
		case http.MethodPost:
			var req struct {
				Content string `json:"content"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			path := snolcConfigPath(cfg)
			if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if err := os.WriteFile(path, []byte(req.Content), 0o644); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			cmd := exec.Command(snolcBinary, "validate", path)
			out, err := cmd.CombinedOutput()
			if err != nil {
				http.Error(w, fmt.Sprintf("%s: %s", err.Error(), strings.TrimSpace(string(out))), http.StatusBadRequest)
				return
			}
			writeJSON(w, configResponse{Path: path, Content: req.Content, Exists: true})
		default:
			w.Header().Set("Allow", "GET, POST")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}
}

// ---------------------------------------------------------------- snolc helpers

func snolcConfigPath(cfg panelConfig) string {
	return filepath.Join(cfg.Dir, "snolc.toml")
}

func tlsCertPath(cfg panelConfig) string {
	if path := strings.TrimSpace(os.Getenv("SNOLC_WEB_TLS_CERT")); path != "" {
		return path
	}
	return filepath.Join(cfg.Dir, "tls.crt")
}

func tlsKeyPath(cfg panelConfig) string {
	if path := strings.TrimSpace(os.Getenv("SNOLC_WEB_TLS_KEY")); path != "" {
		return path
	}
	return filepath.Join(cfg.Dir, "tls.key")
}

func installedVersion() string {
	cmd := exec.Command(snolcBinary, "version")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return parseVersionLine(strings.TrimSpace(string(out)))
}

func parseVersionLine(line string) string {
	fields := strings.Fields(strings.TrimSpace(line))
	if len(fields) >= 2 {
		return fields[1]
	}
	return strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "snolc"))
}

func snolcRunStatus(cfg panelConfig) (bool, int) {
	pid := readPIDFile(cfg)
	if pid == 0 {
		return false, 0
	}
	return isAlive(pid), pid
}

func readPIDFile(cfg panelConfig) int {
	data, err := os.ReadFile(filepath.Join(cfg.Dir, "snolc.pid"))
	if err != nil {
		return 0
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil || pid <= 0 {
		return 0
	}
	return pid
}

func writePIDFile(cfg panelConfig, pid int) error {
	return os.WriteFile(filepath.Join(cfg.Dir, "snolc.pid"), []byte(strconv.Itoa(pid)+"\n"), 0o644)
}

func removePIDFile(cfg panelConfig) {
	_ = os.Remove(filepath.Join(cfg.Dir, "snolc.pid"))
}

func isAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, syscall.Signal(0))
	return err == nil || err == syscall.EPERM
}

// ---------------------------------------------------------------- actions

func startHandler(cfg panelConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		config := snolcConfigPath(cfg)
		if _, err := os.Stat(config); err != nil {
			http.Error(w, "config file not found: "+config, http.StatusBadRequest)
			return
		}
		if pid := readPIDFile(cfg); pid > 0 && isAlive(pid) {
			http.Error(w, "already running", http.StatusConflict)
			return
		}
		logFile := filepath.Join(cfg.Dir, "run.log")
		cmd := exec.Command(snolcBinary, "run", config)
		f, err := os.OpenFile(logFile, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		cmd.Stdout = f
		cmd.Stderr = f
		if err := cmd.Start(); err != nil {
			f.Close()
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if err := writePIDFile(cfg, cmd.Process.Pid); err != nil {
			cmd.Process.Kill()
			f.Close()
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		go func() { _ = cmd.Wait() }()
		fmt.Fprintf(f, "\n== snolc run started %s (pid %d) ==\n", time.Now().Format(time.RFC3339), cmd.Process.Pid)
		writeJSON(w, map[string]any{"running": true, "pid": cmd.Process.Pid})
	}
}

func stopHandler(cfg panelConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		pid := readPIDFile(cfg)
		if pid > 0 && isAlive(pid) {
			_ = syscall.Kill(pid, syscall.SIGTERM)
			removePIDFile(cfg)
		}
		writeJSON(w, map[string]any{"running": false})
	}
}

func restartHandler(cfg panelConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		stopHandler(cfg).ServeHTTP(w, r)
		if w.Header().Get("Content-Type") == "application/json" {
			// body of stop was written; fall through to start
		}
		startHandler(cfg).ServeHTTP(w, r)
	}
}

func installHandler(cfg panelConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		installMu.Lock()
		if installRunning {
			installMu.Unlock()
			writeJSONStatus(w, http.StatusConflict, map[string]any{"error": "install already running"})
			return
		}
		installRunning = true
		installMu.Unlock()
		go func() {
			defer func() {
				installMu.Lock()
				installRunning = false
				installMu.Unlock()
			}()
			var script string
			for _, candidate := range []string{
				filepath.Join(filepath.Dir(adminConfigPath), "scripts", "install-snolc.sh"),
				filepath.Join(filepath.Dir(filepath.Dir(adminConfigPath)), "snolc-web-src", "scripts", "install-snolc.sh"),
				"/opt/snolc-web-src/scripts/install-snolc.sh",
			} {
				if _, err := os.Stat(candidate); err == nil {
					script = candidate
					break
				}
			}
			if script == "" {
				http.Error(w, "install-snolc.sh not found", http.StatusInternalServerError)
				return
			}
			if out, err := runScriptToLog(script, filepath.Join(cfg.Dir, "install.log")); err != nil {
				log.Printf("snolc install failed: %v: %s", err, out)
				return
			}
			if v := installedVersion(); v != "" {
				if err := os.WriteFile(panelVersionPath(cfg), []byte(v+"\n"), 0o644); err != nil {
					log.Printf("write panel version: %v", err)
				}
			}
		}()
		writeJSON(w, map[string]any{"started": true, "log": filepath.Join(cfg.Dir, "install.log")})
	}
}

func runScriptToLog(script, logFile string) (string, error) {
	f, err := os.OpenFile(logFile, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return "", err
	}
	defer f.Close()
	cmd := exec.Command("/bin/sh", script)
	cmd.Stdout = f
	cmd.Stderr = f
	err = cmd.Run()
	return fmt.Sprintf("%v", err), err
}

// ---------------------------------------------------------------- update check

type ghRelease struct {
	TagName     string `json:"tag_name"`
	Name        string `json:"name"`
	Body        string `json:"body"`
	HTMLURL     string `json:"html_url"`
	Prerelease  bool   `json:"prerelease"`
	PublishedAt string `json:"published_at"`
}

func latestSnolcRelease() (ghRelease, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(githubAPIURL)
	if err != nil {
		return ghRelease{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ghRelease{}, fmt.Errorf("http %d", resp.StatusCode)
	}
	var rel ghRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&rel); err != nil {
		return ghRelease{}, err
	}
	return rel, nil
}

func versionCompare(a, b string) (ok bool, newer bool) {
	parse := func(v string) []int {
		v = strings.TrimSpace(strings.TrimPrefix(v, "v"))
		var out []int
		for _, part := range strings.Split(v, ".") {
			n, err := strconv.Atoi(strings.TrimSpace(strings.TrimRightFunc(part, func(r rune) bool {
				return !(r >= '0' && r <= '9')
			})))
			if err != nil {
				n = 0
			}
			out = append(out, n)
		}
		return out
	}
	pa, pb := parse(a), parse(b)
	n := len(pa)
	if len(pb) > n {
		n = len(pb)
	}
	for i := 0; i < n; i++ {
		va, vb := 0, 0
		if i < len(pa) {
			va = pa[i]
		}
		if i < len(pb) {
			vb = pb[i]
		}
		if va != vb {
			return true, va > vb
		}
	}
	return true, false
}

func updateCheckHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	current := installedVersion()
	var latest string
	var errStr string
	if rel, err := latestSnolcRelease(); err != nil {
		errStr = err.Error()
	} else {
		latest = strings.TrimPrefix(rel.TagName, "v")
	}
	available := false
	if latest != "" && current != "" {
		ok, newer := versionCompare(latest, current)
		if ok && newer {
			available = true
		}
	}
	writeJSON(w, updateCheckResponse{
		Current:         current,
		Latest:          latest,
		UpdateAvailable: available,
		Changelog:       latestReleaseChangelog(),
		Error:           errStr,
	})
}

func latestReleaseChangelog() string {
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(snolcRepoURL + "/releases/latest")
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ""
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return ""
	}
	text := string(data)
	start := strings.Index(text, "## ")
	if start >= 0 {
		end := strings.Index(text[start:], "<h2")
		if end >= 0 {
			return strings.TrimSpace(text[start:end])
		}
		return strings.TrimSpace(text[start:])
	}
	return ""
}

// ---------------------------------------------------------------- actions log

func actionsLogHandler(cfg panelConfig) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		installMu.Lock()
		running := installRunning
		installMu.Unlock()
		updateMu.Lock()
		running = running || updateRunning
		updateMu.Unlock()

		var logStr string
		var progress int
		for _, logFile := range []string{filepath.Join(cfg.Dir, "install.log"), filepath.Join(cfg.Dir, "update.log")} {
			if data, err := os.ReadFile(logFile); err == nil {
				if progress == 0 {
					progress = readProgress(string(data))
				}
				logStr = string(data)
			}
		}
		writeJSON(w, logResponse{Running: fmt.Sprintf("%t", running), Progress: progress, Log: readTail(logStr, 64<<10)})
	}
}

var progressRe = regexp.MustCompile(`\[PROGRESS:(\d+)\]`)

func readProgress(s string) int {
	all := progressRe.FindAllStringSubmatch(s, -1)
	if len(all) == 0 {
		return 0
	}
	n, err := strconv.Atoi(all[len(all)-1][1])
	if err != nil {
		return 0
	}
	if n > 100 {
		n = 100
	}
	return n
}

func readTail(s string, max int) string {
	if len(s) <= max {
		return s
	}
	s = s[len(s)-max:]
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[i+1:]
	}
	return s
}
