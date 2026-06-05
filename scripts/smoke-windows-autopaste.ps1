$ErrorActionPreference = "Stop"

if (-not $IsWindows) {
  throw "The Windows auto-paste smoke can only run on Windows."
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AuralisWin32PasteSmoke {
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@

$targetFile = Join-Path $env:RUNNER_TEMP "auralis-windows-paste-target.txt"
$sentinel = "Auralis Windows paste smoke " + [Guid]::NewGuid().ToString("N")
Set-Content -Path $targetFile -Value "" -NoNewline -Encoding UTF8

$notepad = Start-Process -FilePath "notepad.exe" -ArgumentList "`"$targetFile`"" -PassThru
try {
  $deadline = (Get-Date).AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 250
    $notepad.Refresh()
    $targetHandle = $notepad.MainWindowHandle
  } while ($targetHandle -eq 0 -and (Get-Date) -lt $deadline)

  if ($targetHandle -eq 0) {
    throw "Notepad did not expose a foreground window handle for paste smoke."
  }

  Set-Clipboard -Value $sentinel

  $hwnd = [IntPtr]$targetHandle
  [void][AuralisWin32PasteSmoke]::ShowWindowAsync($hwnd, 9)
  [void][AuralisWin32PasteSmoke]::SetForegroundWindow($hwnd)
  Start-Sleep -Milliseconds 500

  [System.Windows.Forms.SendKeys]::SendWait("^v")
  Start-Sleep -Milliseconds 250
  [System.Windows.Forms.SendKeys]::SendWait("^s")
  Start-Sleep -Milliseconds 500
} finally {
  if ($notepad -and -not $notepad.HasExited) {
    [void]$notepad.CloseMainWindow()
    Start-Sleep -Milliseconds 500
    if (-not $notepad.HasExited) {
      Stop-Process -Id $notepad.Id -Force
    }
  }
}

$content = Get-Content -Path $targetFile -Raw
if ($content -notlike "*$sentinel*") {
  throw "Windows auto-paste smoke failed: Notepad file did not receive the clipboard sentinel."
}

Write-Host "Windows auto-paste mechanism smoke wrote clipboard text into Notepad successfully."
