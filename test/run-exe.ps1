/** 启动原版 exe 并截图，看它到底有什么功能 */
$ErrorActionPreference = 'SilentlyContinue'
$exe = 'C:\Users\Administrator\Desktop\抖音综合工具.exe'
if (-not (Test-Path $exe)) { Write-Output 'exe 不存在'; exit 1 }

Write-Output "启动: $exe"
Get-Process -Name '抖音综合工具' | Stop-Process -Force
Start-Sleep -Seconds 1
$p = Start-Process -FilePath $exe -PassThru
Write-Output "PID: $($p.Id)"
Start-Sleep -Seconds 12

# 找它的窗口
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public static System.Collections.Generic.List<string> Find(uint targetPid) {
    var list = new System.Collections.Generic.List<string>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == targetPid && IsWindowVisible(h)) {
        var sb = new StringBuilder(512);
        GetWindowTextW(h, sb, 512);
        RECT r; GetWindowRect(h, out r);
        list.Add(h.ToInt64() + "|" + sb.ToString() + "|" + (r.R - r.L) + "x" + (r.B - r.T));
      }
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
"@

$wins = [Win]::Find([uint32]$p.Id)
Write-Output "窗口数: $($wins.Count)"
foreach ($w in $wins) { Write-Output "  $w" }

# 截屏
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$out = 'C:\Users\Administrator\Documents\deepseek-harness\default-workspace\douyin-suite\test\exe-screen.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "截图: $out"
Write-Output "进程状态: $((Get-Process -Id $p.Id).Responding)"
