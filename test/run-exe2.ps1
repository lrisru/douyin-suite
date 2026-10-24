$ErrorActionPreference = 'SilentlyContinue'
$exe = 'C:\Users\Administrator\Desktop\' + [char]0x6296 + [char]0x97F3 + [char]0x7EFC + [char]0x5408 + [char]0x5DE5 + [char]0x5177 + '.exe'
if (-not (Test-Path $exe)) {
  $found = Get-ChildItem 'C:\Users\Administrator\Desktop\*.exe' | Select-Object -First 5
  Write-Output 'target not found, listing desktop exe:'
  $found | ForEach-Object { Write-Output ('  ' + $_.Name) }
  exit 1
}

Write-Output ("launch: " + $exe)
Get-Process | Where-Object { $_.Path -eq $exe } | Stop-Process -Force
Start-Sleep -Seconds 1
$p = Start-Process -FilePath $exe -PassThru
Write-Output ("pid: " + $p.Id)
Start-Sleep -Seconds 12

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
Write-Output ("windows: " + $wins.Count)
foreach ($w in $wins) { Write-Output ("  " + $w) }

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$out = 'C:\Users\Administrator\Documents\deepseek-harness\default-workspace\douyin-suite\test\exe-screen.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output ("screenshot: " + $out)
$alive = Get-Process -Id $p.Id
Write-Output ("alive: " + [bool]$alive + " responding: " + $alive.Responding)
