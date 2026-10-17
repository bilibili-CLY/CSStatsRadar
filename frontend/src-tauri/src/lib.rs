//! CSStatsRadar 桌面壳：轻量 Tauri 窗口 + .NET sidecar 进程管家。
//!
//! 模式对齐 CS2-insight-agent（Tauri 2 + 内嵌后端 + NSIS），但后端是自研的
//! Kestrel sidecar（`CSStatsRadar.Server`），不是 Python。职责只有三件事：
//! 1. 拉起 sidecar 并确认身份（instance_id 防止连到 чужой 进程）；
//! 2. 关闭时先问 sidecar 能否退出，再优雅停服，超时才强杀；
//! 3. 单实例 + 启动失败弹窗，不静默、无残留进程。

use std::{
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// sidecar 固定端口（与 Radar.Server 默认值一致）。若被占用导致漂移，
/// 直接报错退出——静默连错端口比 loud failure 危险得多。
const BACKEND_PORT: u16 = 19871;

struct Sidecar {
    child: Mutex<Option<ManagedSidecar>>,
    exit_pending: AtomicBool,
    exit_approved: AtomicBool,
}

impl Sidecar {
    fn new() -> Self {
        Self {
            child: Mutex::new(None),
            exit_pending: AtomicBool::new(false),
            exit_approved: AtomicBool::new(false),
        }
    }
}

struct ManagedSidecar {
    child: Child,
    instance_id: String,
    port: u16,
}

fn new_instance_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{}-{nanos}", std::process::id())
}

struct HttpResponse {
    status: u16,
    body: String,
}

fn raw_http(method: &str, path: &str, port: u16, timeout: Duration) -> Option<HttpResponse> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(350)).ok()?;
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).ok()?;
    let mut raw = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => raw.extend_from_slice(&buffer[..count]),
            // 读超时或对端已关闭：已经读到的内容照样尝试解析。
            Err(_) => break,
        }
    }
    parse_http_response(&raw)
}

/// 解析 HTTP/1.1 响应（保留状态码与去分帧后的 body）。
///
/// Kestrel 对 minimal-API 的 JSON 响应默认使用 `Transfer-Encoding: chunked`，
/// 所以绝不能在第一个空行处切分就当成 body：那样拿到的是
/// `77\r\n{json}\r\n0\r\n\r\n` 这类分帧数据，serde_json 必然解析失败，
/// 身份握手（instance_id）和 prepare-exit 都会误判为失败。
fn parse_http_response(raw: &[u8]) -> Option<HttpResponse> {
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = std::str::from_utf8(&raw[..split]).ok()?;
    let mut lines = head.split("\r\n");
    let status = lines.next()?.split_whitespace().nth(1)?.parse::<u16>().ok()?;
    let mut content_length: Option<usize> = None;
    let mut chunked = false;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim().to_ascii_lowercase();
        match name.as_str() {
            "transfer-encoding" => {
                chunked = value.split(',').any(|token| token.trim() == "chunked");
            }
            "content-length" => content_length = value.parse::<usize>().ok(),
            _ => {}
        }
    }
    let rest = &raw[split + 4..];
    let body = if chunked {
        dechunk(rest)?
    } else {
        match content_length {
            Some(length) if length <= rest.len() => rest[..length].to_vec(),
            _ => rest.to_vec(),
        }
    };
    Some(HttpResponse {
        status,
        body: String::from_utf8_lossy(&body).into_owned(),
    })
}

/// 去掉 chunked 分帧：`<hex 长度>[;扩展]\r\n<数据>\r\n` … `0\r\n\r\n`。
fn dechunk(raw: &[u8]) -> Option<Vec<u8>> {
    let mut rest = raw;
    let mut body = Vec::new();
    loop {
        let line_end = rest.windows(2).position(|w| w == b"\r\n")?;
        let size_text = std::str::from_utf8(&rest[..line_end]).ok()?;
        let size = usize::from_str_radix(size_text.split(';').next()?.trim(), 16).ok()?;
        rest = &rest[line_end + 2..];
        if size == 0 {
            return Some(body);
        }
        if rest.len() < size {
            return None;
        }
        body.extend_from_slice(&rest[..size]);
        rest = &rest[size..];
        if rest.len() < 2 {
            return None;
        }
        rest = &rest[2..];
    }
}

fn response_json(response: &HttpResponse) -> Option<serde_json::Value> {
    serde_json::from_str(&response.body).ok()
}

/// sidecar 可执行文件：release 用安装包内嵌（自包含单文件，无需目标机装 .NET）；
/// debug（`tauri dev`）用仓库源码 + 本机 dotnet，便于 Mac 调试。
fn server_executable(app: &AppHandle) -> Result<(PathBuf, bool), String> {
    if cfg!(debug_assertions) {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .map_err(|error| format!("无法解析仓库目录：{error}"))?;
        let dll = root.join("src/Radar.Server/bin/Debug/net8.0/CSStatsRadar.Server.dll");
        if !dll.is_file() {
            return Err(format!(
                "未找到 sidecar，请先执行 dotnet build：{}",
                dll.display()
            ));
        }
        Ok((dll, true))
    } else {
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|error| format!("无法解析安装资源目录：{error}"))?;
        #[cfg(windows)]
        let exe = resource_dir.join("server").join("CSStatsRadar.Server.exe");
        #[cfg(not(windows))]
        let exe = resource_dir.join("server").join("CSStatsRadar.Server");
        if !exe.is_file() {
            return Err(format!("安装包缺失后端：{}", exe.display()));
        }
        Ok((exe, false))
    }
}

/// 日志目录：与 sidecar 共用 `<主目录>/.csplayerstatsradar/logs`
/// （sidecar 的 backend.log 也在这里），解析不到主目录时退回 Tauri 应用数据目录。
/// 绝不使用进程工作目录：那样日志会散落在安装器所在盘（例如 E:\）。
fn logs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .home_dir()
        .map(|home| home.join(".csplayerstatsradar").join("logs"))
        .or_else(|_| app.path().app_data_dir().map(|dir| dir.join("logs")))
        .map_err(|error| format!("无法解析日志目录：{error}"))?;
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建日志目录：{error}"))?;
    Ok(dir)
}

fn append_log(dir: &Path, message: &str) {
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("desktop.log"))
    {
        let _ = writeln!(file, "{message}");
    }
}

fn pipe_to_log<R: std::io::Read + Send + 'static>(stream: R, dir: PathBuf, prefix: &str) {
    let prefix = prefix.to_string();
    thread::spawn(move || {
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            append_log(&dir, &format!("{prefix} {line}"));
        }
    });
}

fn start_sidecar(app: &AppHandle) -> Result<(), String> {
    let (exe, via_dotnet) = server_executable(app)?;
    let logs = logs_dir(app)?;
    let log_hint = format!("日志目录：{}", logs.display());
    let instance_id = new_instance_id();
    append_log(
        &logs,
        &format!("[shell] starting sidecar: {} instance={instance_id}", exe.display()),
    );

    let mut command = if via_dotnet {
        let mut c = Command::new("dotnet");
        c.arg(&exe);
        c
    } else {
        Command::new(&exe)
    };
    command
        .env("CS_RADAR_PORT", BACKEND_PORT.to_string())
        .env("CS_RADAR_INSTANCE_ID", &instance_id)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动后端（{}）：{error}", exe.display()))?;

    if let Some(stdout) = child.stdout.take() {
        pipe_to_log(stdout, logs.clone(), "[sidecar]");
    }
    if let Some(stderr) = child.stderr.take() {
        pipe_to_log(stderr, logs.clone(), "[sidecar:err]");
    }

    // 立即登记：启动期关闭窗口也能回收子进程，不留孤儿。
    {
        let state = app.state::<Sidecar>();
        let mut guard = state
            .child
            .lock()
            .map_err(|_| "后端进程状态锁已损坏".to_string())?;
        *guard = Some(ManagedSidecar {
            child,
            instance_id: instance_id.clone(),
            port: BACKEND_PORT,
        });
    }

    // 等身份确认：runtime-state 必须回显本次 instance_id。
    let mut ready = false;
    let mut observed: Option<String> = None;
    for _ in 0..150 {
        {
            let state = app.state::<Sidecar>();
            let mut guard = state
                .child
                .lock()
                .map_err(|_| "后端进程状态锁已损坏".to_string())?;
            let Some(managed) = guard.as_mut() else {
                // stop_sidecar 已接管：正在退出，直接返回。
                return Ok(());
            };
            if managed.child.try_wait().ok().flatten().is_some() {
                *guard = None;
                return Err(format!("后端在启动阶段退出。\n{log_hint}"));
            }
        }
        if let Some(response) = raw_http("GET", "/api/app/runtime-state", BACKEND_PORT, Duration::from_secs(2)) {
            if let Some(state) = response_json(&response) {
                if let Some(other) = state.get("instance_id").and_then(|v| v.as_str()) {
                    if other == instance_id {
                        ready = true;
                        break;
                    }
                    observed = Some(other.to_string());
                }
            }
        }
        thread::sleep(Duration::from_millis(100));
    }
    if !ready {
        stop_sidecar(app);
        return Err(match observed {
            // 端口上确实有别的 sidecar 应答（多数是上一次没退干净的实例）。
            Some(other) => format!(
                "端口 {BACKEND_PORT} 已被另一个后端实例占用（instance={other}）。\n请结束该进程后重新启动本程序。\n{log_hint}"
            ),
            None => format!("后端启动超时（15s 未确认身份），请检查端口 19871 是否被占用。\n{log_hint}"),
        });
    }
    append_log(&logs, "[shell] sidecar ready");
    Ok(())
}

fn stop_sidecar(app: &AppHandle) {
    let state = app.state::<Sidecar>();
    let Ok(mut guard) = state.child.lock() else {
        return;
    };
    let Some(mut managed) = guard.take() else {
        return;
    };
    drop(guard);
    if managed.child.try_wait().ok().flatten().is_some() {
        return;
    }
    let _ = raw_http(
        "POST",
        "/api/app/shutdown",
        managed.port,
        Duration::from_secs(5),
    );
    for _ in 0..100 {
        if managed.child.try_wait().ok().flatten().is_some() {
            return;
        }
        thread::sleep(Duration::from_millis(100));
    }
    #[cfg(windows)]
    {
        let mut taskkill = Command::new("taskkill");
        taskkill.args(["/pid", &managed.child.id().to_string(), "/f", "/t"]);
        taskkill.creation_flags(CREATE_NO_WINDOW);
        let _ = taskkill.status();
    }
    let _ = managed.child.kill();
    let _ = managed.child.wait();
}

const EXIT_BLOCKED_FALLBACK: &str = "暂时无法确认后台任务状态，请稍后重试。";

fn check_exit_allowed(app: &AppHandle) -> Result<(), String> {
    let (instance_id, port) = {
        let state = app.state::<Sidecar>();
        let guard = state
            .child
            .lock()
            .map_err(|_| EXIT_BLOCKED_FALLBACK.to_string())?;
        let Some(managed) = guard.as_ref() else {
            return Ok(());
        };
        (managed.instance_id.clone(), managed.port)
    };
    let response = raw_http(
        "POST",
        &format!("/api/app/prepare-exit?instance_id={instance_id}"),
        port,
        Duration::from_secs(15),
    )
    .ok_or_else(|| EXIT_BLOCKED_FALLBACK.to_string())?;
    let state = response_json(&response).ok_or_else(|| EXIT_BLOCKED_FALLBACK.to_string())?;
    if state.get("instance_id").and_then(|v| v.as_str()) != Some(instance_id.as_str()) {
        return Err(EXIT_BLOCKED_FALLBACK.to_string());
    }
    match state.get("allowed").and_then(|v| v.as_bool()) {
        Some(true) => Ok(()),
        Some(false) => Err(state
            .get("message")
            .and_then(|v| v.as_str())
            .filter(|m| !m.trim().is_empty())
            .unwrap_or(EXIT_BLOCKED_FALLBACK)
            .to_string()),
        None => Err(EXIT_BLOCKED_FALLBACK.to_string()),
    }
}

fn request_exit(handle: &AppHandle, code: i32) {
    let state = handle.state::<Sidecar>();
    if state.exit_pending.swap(true, Ordering::SeqCst) {
        return;
    }
    let handle = handle.clone();
    thread::spawn(move || {
        if let Err(message) = check_exit_allowed(&handle) {
            handle
                .dialog()
                .message(message)
                .title("CSStatsRadar — 暂时无法关闭")
                .kind(MessageDialogKind::Warning)
                .blocking_show();
            handle
                .state::<Sidecar>()
                .exit_pending
                .store(false, Ordering::SeqCst);
            return;
        }
        if let Some(window) = handle.get_webview_window("main") {
            let _ = window.destroy();
        }
        stop_sidecar(&handle);
        handle
            .state::<Sidecar>()
            .exit_approved
            .store(true, Ordering::SeqCst);
        handle.exit(code);
    });
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(Sidecar::new())
        .setup(|app| {
            // 后台线程起 sidecar：窗口（及前端 boot 画面的重试）先出现，
            // 不因 dotnet 冷启动阻塞 UI。
            let handle = app.handle().clone();
            thread::spawn(move || {
                if let Err(error) = start_sidecar(&handle) {
                    handle
                        .dialog()
                        .message(format!("{error}\n\n请重装完整安装包，或查看应用数据目录中的日志。"))
                        .title("CSStatsRadar — 后端启动失败")
                        .kind(MessageDialogKind::Error)
                        .blocking_show();
                    handle
                        .state::<Sidecar>()
                        .exit_approved
                        .store(true, Ordering::SeqCst);
                    handle.exit(1);
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build CSStatsRadar desktop shell");

    app.run(|handle, event| match event {
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" => {
            api.prevent_close();
            request_exit(handle, 0);
        }
        RunEvent::ExitRequested { code, api, .. } => {
            if code.is_none()
                || (code != Some(tauri::RESTART_EXIT_CODE)
                    && !handle
                        .state::<Sidecar>()
                        .exit_approved
                        .load(Ordering::SeqCst))
            {
                api.prevent_exit();
                if let Some(code) = code {
                    request_exit(handle, code);
                }
            }
        }
        RunEvent::Exit => stop_sidecar(handle),
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::{dechunk, parse_http_response, response_json};

    /// 实测报文（Windows 上 v2.3.0 的崩溃现场）：Kestrel 对 minimal-API 的
    /// `Results.Json` 响应使用 `Transfer-Encoding: chunked`。
    const CHUNKED: &str = "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: application/json; charset=utf-8\r\nDate: Sat, 17 Oct 2026 19:08:22 GMT\r\nServer: Kestrel\r\nTransfer-Encoding: chunked\r\n\r\n77\r\n{\"pid\":38637,\"instance_id\":\"test-instance-1\",\"version\":\"2.3.0.0\",\"data_dir\":\"/tmp/csr-probe\",\"recovery_required\":false}\r\n0\r\n\r\n";
    const FIXED: &str = "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: 11\r\n\r\n{\"ok\":true}";

    #[test]
    fn parses_chunked_json() {
        let response = parse_http_response(CHUNKED.as_bytes()).expect("chunked response");
        assert_eq!(response.status, 200);
        let json = response_json(&response).expect("json body");
        assert_eq!(
            json.get("instance_id").and_then(|v| v.as_str()),
            Some("test-instance-1")
        );
    }

    #[test]
    fn parses_content_length_json() {
        let response = parse_http_response(FIXED.as_bytes()).expect("fixed response");
        assert_eq!(response.status, 200);
        assert_eq!(
            response_json(&response).and_then(|v| v.get("ok").and_then(|v| v.as_bool())),
            Some(true)
        );
    }

    #[test]
    fn dechunk_joins_multiple_chunks() {
        assert_eq!(
            dechunk(b"3\r\nabc\r\n2\r\nde\r\n0\r\n\r\n").as_deref(),
            Some(&b"abcde"[..])
        );
    }

    #[test]
    fn keeps_status_code_from_error_response() {
        let raw = "HTTP/1.1 409 Conflict\r\nContent-Length: 17\r\n\r\n{\"allowed\":false}";
        let response = parse_http_response(raw.as_bytes()).expect("409 response");
        assert_eq!(response.status, 409);
    }

    #[test]
    fn missing_body_metadata_still_returns_remainder() {
        let raw = "HTTP/1.1 200 OK\r\n\r\n{\"a\":1}";
        let response = parse_http_response(raw.as_bytes()).expect("no metadata");
        assert_eq!(response.body, "{\"a\":1}");
    }
}
