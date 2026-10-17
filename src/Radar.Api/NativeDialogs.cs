using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

namespace Radar.Api;

public static class NativeDialogs
{
    private static readonly bool IsMacOS = OperatingSystem.IsMacOS();
    private static readonly bool IsWindows = OperatingSystem.IsWindows();

    public static string? ChooseDirectory(string title)
    {
        if (IsMacOS) return MacChooseDirectory(title);
        if (IsWindows)
        {
            var result = RunWindowsDialog("folder", title, "", "", "", "");
            return result == null ? null : result[0];
        }
        return null;
    }

    public static List<string>? ChooseFiles(string title, params string[] extensions)
    {
        if (IsMacOS) return MacChooseFiles(title, extensions);
        if (IsWindows)
        {
            var result = RunWindowsDialog("openmulti", title, "", FilterFor(extensions), "", "");
            return result == null ? null : result.ToList();
        }
        return null;
    }

    public static string? ChooseFile(string title, params string[] extensions)
    {
        if (IsMacOS) return MacChooseFile(title, extensions);
        if (IsWindows)
        {
            var result = RunWindowsDialog("open", title, "", FilterFor(extensions), "", "");
            return result == null ? null : result[0];
        }
        return null;
    }

    public static string? SaveFile(string title, string defaultName, string defaultDir, params string[] extensions)
    {
        if (IsMacOS) return MacSaveFile(title, defaultName, defaultDir, extensions);
        if (IsWindows)
        {
            var result = RunWindowsDialog("save", title, defaultDir, FilterFor(extensions), defaultName, FirstExtension(extensions) ?? "");
            return result == null ? null : result[0];
        }
        return null;
    }

    private static string? FirstExtension(string[] extensions)
        => extensions.Select(e => e.TrimStart('.').Trim()).FirstOrDefault(e => e.Length > 0);

    private static string FilterFor(string[] extensions)
    {
        var names = extensions
            .Select(e => e.TrimStart('.').Trim())
            .Where(e => e.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (names.Count == 0) return "所有文件 (*.*)|*.*";
        var patterns = string.Join(";", names.Select(e => "*." + e));
        return $"{string.Join(";", names)} 文件 ({patterns})|{patterns}|所有文件 (*.*)|*.*";
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    /// <summary>
    /// 取当前前台窗口句柄作为对话框属主：bridge/sidecar 进程弹窗时若无属主，
    /// Windows 前台锁定会把它压到浏览器/应用主窗口之下（用户会以为没有反应）。
    /// </summary>
    private static long ForegroundWindowHandle()
    {
        if (!OperatingSystem.IsWindows()) return 0;
        try
        {
            return GetForegroundWindow().ToInt64();
        }
        catch
        {
            return 0;
        }
    }

    private static List<string>? RunWindowsDialog(string kind, string title, string initialPath, string filter, string defaultName, string defaultExt)
    {
        try
        {
            var ownerHwnd = ForegroundWindowHandle();
            var scriptPath = Path.Combine(Path.GetTempPath(), "cs-radar-dialog-" + Guid.NewGuid().ToString("N") + ".ps1");
            File.WriteAllText(scriptPath, WinDialogScript, new UTF8Encoding(false));
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    StandardOutputEncoding = new UTF8Encoding(false),
                };
                psi.ArgumentList.Add("-NoProfile");
                psi.ArgumentList.Add("-NonInteractive");
                psi.ArgumentList.Add("-ExecutionPolicy");
                psi.ArgumentList.Add("Bypass");
                psi.ArgumentList.Add("-STA");
                psi.ArgumentList.Add("-File");
                psi.ArgumentList.Add(scriptPath);
                psi.ArgumentList.Add("-Kind"); psi.ArgumentList.Add(kind);
                psi.ArgumentList.Add("-Title"); psi.ArgumentList.Add(title);
                psi.ArgumentList.Add("-InitialPath"); psi.ArgumentList.Add(initialPath ?? "");
                psi.ArgumentList.Add("-Filter"); psi.ArgumentList.Add(filter);
                psi.ArgumentList.Add("-DefaultName"); psi.ArgumentList.Add(defaultName ?? "");
                psi.ArgumentList.Add("-DefaultExt"); psi.ArgumentList.Add(defaultExt ?? "");
                psi.ArgumentList.Add("-OwnerHwnd"); psi.ArgumentList.Add(ownerHwnd.ToString(CultureInfo.InvariantCulture));
                using var process = Process.Start(psi);
                if (process == null) return null;
                var stdout = process.StandardOutput.ReadToEnd();
                process.WaitForExit(TimeSpan.FromMinutes(10));
                var lines = stdout.Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0).ToList();
                return lines.Count == 0 ? null : lines;
            }
            finally
            {
                try { File.Delete(scriptPath); } catch { /* ignore */ }
            }
        }
        catch
        {
            return null;
        }
    }

    private const string WinDialogScript = @"param(
  [string]$Kind,
  [string]$Title,
  [string]$InitialPath,
  [string]$Filter,
  [string]$DefaultName,
  [string]$DefaultExt,
  [long]$OwnerHwnd = 0
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$dialog = $null
switch ($Kind) {
  'save' {
    $dialog = New-Object System.Windows.Forms.SaveFileDialog
    $dialog.Title = $Title
    $dialog.OverwritePrompt = $true
    if ($InitialPath -and (Test-Path $InitialPath)) { $dialog.InitialDirectory = $InitialPath }
    if ($DefaultName) { $dialog.FileName = $DefaultName }
    if ($DefaultExt) { $dialog.DefaultExt = $DefaultExt; $dialog.AddExtension = $true }
    $dialog.Filter = $Filter
  }
  'open' {
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = $Title
    $dialog.Multiselect = $false
    if ($InitialPath -and (Test-Path $InitialPath)) { $dialog.InitialDirectory = $InitialPath }
    $dialog.Filter = $Filter
  }
  'openmulti' {
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = $Title
    $dialog.Multiselect = $true
    if ($InitialPath -and (Test-Path $InitialPath)) { $dialog.InitialDirectory = $InitialPath }
    $dialog.Filter = $Filter
  }
  'folder' {
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = $Title
    if ($InitialPath -and (Test-Path $InitialPath)) { $dialog.SelectedPath = $InitialPath }
  }
}
if ($dialog -eq $null) { exit 1 }
$fallback = $null
$showOwner = $null
if ($OwnerHwnd -ne 0) {
  # 用前台窗口（浏览器/应用主窗口）作为对话框属主，保证对话框位于其上方并获得焦点。
  if (-not ('CsRadarWindowWrapper' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Windows.Forms;
public class CsRadarWindowWrapper : IWin32Window
{
    private readonly IntPtr handle;
    public CsRadarWindowWrapper(IntPtr h) { handle = h; }
    public IntPtr Handle { get { return handle; } }
}
'@ -ReferencedAssemblies System.Windows.Forms
  }
  $showOwner = New-Object CsRadarWindowWrapper([IntPtr]$OwnerHwnd)
}
if ($showOwner -eq $null) {
  # 取不到前台窗口时退回隐藏的 TopMost 窗口作为属主。
  $fallback = New-Object System.Windows.Forms.Form
  $fallback.ShowInTaskbar = $false
  $fallback.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
  $fallback.TopMost = $true
  $fallback.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
  $fallback.Location = New-Object System.Drawing.Point(-32000, -32000)
  $fallback.Width = 1
  $fallback.Height = 1
  $showOwner = $fallback
}
$output = $null
try {
  $result = $dialog.ShowDialog($showOwner)
  if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    if ($Kind -eq 'openmulti') { $output = $dialog.FileNames } else { $output = @($dialog.FileName) }
  }
} finally {
  if ($fallback -ne $null) { $fallback.Dispose() }
  $dialog.Dispose()
}
if ($output -eq $null) { exit 0 }
$output
";

    private static string? MacChooseDirectory(string title)
    {
        var script = new StringBuilder();
        script.AppendLine($"set theTitle to \"{Escape(title)}\"");
        script.AppendLine("return POSIX path of (choose folder with prompt theTitle)");
        var output = RunOsascript(script.ToString());
        return string.IsNullOrWhiteSpace(output) ? null : output.Trim();
    }

    private static List<string>? MacChooseFiles(string title, string[] extensions)
    {
        var types = JoinTypes(extensions);
        var script = new StringBuilder();
        script.AppendLine($"set theTitle to \"{Escape(title)}\"");
        script.AppendLine($"set chosen to choose file of type {{{types}}} with multiple selections allowed with prompt theTitle");
        script.AppendLine("set resultList to {}");
        script.AppendLine("repeat with f in chosen");
        script.AppendLine("\tset end of resultList to POSIX path of f");
        script.AppendLine("end repeat");
        script.AppendLine("set text item delimiters to ASCII character 31");
        script.AppendLine("return resultList as text");
        var output = RunOsascript(script.ToString());
        return ParseMacFileSelectionOutput(output);
    }

    private static List<string>? ParseMacFileSelectionOutput(string? output)
    {
        if (string.IsNullOrWhiteSpace(output)) return null;
        var paths = output.TrimEnd('\r', '\n').Split('\u001f').Where(path => path.Length > 0).ToList();
        return paths.Count == 0 ? null : paths;
    }

    private static string? MacChooseFile(string title, string[] extensions)
    {
        var types = JoinTypes(extensions);
        var script = new StringBuilder();
        script.AppendLine($"set theTitle to \"{Escape(title)}\"");
        script.AppendLine($"set chosen to choose file of type {{{types}}} with prompt theTitle");
        script.AppendLine("return POSIX path of chosen");
        var output = RunOsascript(script.ToString());
        return string.IsNullOrWhiteSpace(output) ? null : output.Trim();
    }

    private static string? MacSaveFile(string title, string defaultName, string defaultDir, string[] extensions)
    {
        var script = new StringBuilder();
        script.AppendLine($"set theTitle to \"{Escape(title)}\"");
        script.AppendLine($"set defaultName to \"{Escape(defaultName)}\"");
        script.AppendLine($"set defaultDir to \"{Escape(defaultDir)}\"");
        script.AppendLine("set chosen to choose file name with prompt theTitle default name defaultName default location defaultDir");
        script.AppendLine("return POSIX path of chosen");
        var output = RunOsascript(script.ToString());
        return string.IsNullOrWhiteSpace(output) ? null : output.Trim();
    }

    private static string Escape(string value)
        => value.Replace("\\", "\\\\").Replace("\"", "\\\"");

    private static string JoinTypes(string[] extensions)
    {
        var normalized = extensions
            .Select(e => e.TrimStart('.'))
            .Where(e => e.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase);
        return string.Join(", ", normalized.Select(e => $"\"{e}\""));
    }

    private static string? RunOsascript(string script)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "osascript",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                StandardOutputEncoding = Encoding.UTF8,
            };
            psi.ArgumentList.Add("-e");
            psi.ArgumentList.Add(script);
            using var process = Process.Start(psi);
            if (process == null) return null;
            var stdout = process.StandardOutput.ReadToEnd();
            process.WaitForExit(TimeSpan.FromSeconds(30));
            return stdout;
        }
        catch
        {
            return null;
        }
    }
}
