using System.Diagnostics;
using System.Text;

namespace Radar.Api;

public static class NativeDialogs
{
    private static readonly bool IsMacOS = OperatingSystem.IsMacOS();

    public static string? ChooseDirectory(string title)
    {
        if (!IsMacOS) return null;
        var script = new StringBuilder();
        script.AppendLine($"set theTitle to \"{Escape(title)}\"");
        script.AppendLine("return POSIX path of (choose folder with prompt theTitle)");
        var output = RunOsascript(script.ToString());
        return string.IsNullOrWhiteSpace(output) ? null : output.Trim();
    }

    public static List<string>? ChooseFiles(string title, params string[] extensions)
    {
        if (!IsMacOS) return null;
        var types = JoinTypes(extensions);
        var script = new StringBuilder();
        script.AppendLine($"set theTitle to \"{Escape(title)}\"");
        script.AppendLine($"set chosen to choose file of type {{{types}}} with multiple selections allowed with prompt theTitle");
        script.AppendLine("set resultList to {}");
        script.AppendLine("repeat with f in chosen");
        script.AppendLine("\tset end of resultList to POSIX path of f");
        script.AppendLine("end repeat");
        script.AppendLine("return resultList");
        var output = RunOsascript(script.ToString());
        if (string.IsNullOrWhiteSpace(output)) return null;
        return output.Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0).ToList();
    }

    public static string? ChooseFile(string title, params string[] extensions)
    {
        if (!IsMacOS) return null;
        var types = JoinTypes(extensions);
        var script = new StringBuilder();
        script.AppendLine($"set theTitle to \"{Escape(title)}\"");
        script.AppendLine($"set chosen to choose file of type {{{types}}} with prompt theTitle");
        script.AppendLine("return POSIX path of chosen");
        var output = RunOsascript(script.ToString());
        return string.IsNullOrWhiteSpace(output) ? null : output.Trim();
    }

    public static string? SaveFile(string title, string defaultName, string defaultDir, params string[] extensions)
    {
        if (!IsMacOS) return null;
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