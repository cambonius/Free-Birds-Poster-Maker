<#
  Tiny local web server for the Free Birds caption maker (no install needed).

  Why: browsers block reading pixels from images opened straight from disk
  (file://), which the "Download PNG" button needs. Serving the folder over
  http://localhost fixes that.

  Usage:
    powershell -ExecutionPolicy Bypass -File serve.ps1            # serve + open browser
    powershell -ExecutionPolicy Bypass -File serve.ps1 -NoBrowser

  Build/verify mode (used by tools\build-masks.ps1 and tools\verify.ps1):
    -SaveRoot <dir>   enables POST /__save?path=<relative path>, writing the
                      request body to <dir>\<path>. Paths may not leave <dir>.
    -Page <url path>  page to open in headless Chrome; the server exits when the
                      page POSTs /__quit (or after -TimeoutSec).
#>
param(
  [int]$Port = 8765,
  [switch]$NoBrowser,
  [string]$SaveRoot = "",
  [string]$Page = "",
  [int]$TimeoutSec = 600
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'
  '.png' = 'image/png'; '.webp' = 'image/webp'; '.jpg' = 'image/jpeg'
  '.ttf' = 'font/ttf'; '.otf' = 'font/otf'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'
}

$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "Serving $Root at $prefix  (Ctrl+C to stop)"

$chrome = $null
if ($Page) {
  $exe = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
           "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
           "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe") |
         Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $exe) { throw "Chrome or Edge not found" }
  $profile = Join-Path $env:TEMP "freebirds-headless-profile"
  $chrome = Start-Process -FilePath $exe -PassThru -ArgumentList @(
    '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    '--window-size=1600,2200', "--user-data-dir=`"$profile`"", "$prefix$($Page.TrimStart('/'))")
} elseif (-not $NoBrowser) {
  Start-Process "${prefix}index.html"
}

function Send-Text($ctx, [int]$code, [string]$text) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($text)
  $ctx.Response.StatusCode = $code
  $ctx.Response.ContentType = 'text/plain; charset=utf-8'
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.Close()
}

$deadline = (Get-Date).AddSeconds($TimeoutSec)
$quit = $false
try {
  while (-not $quit) {
    $async = $listener.BeginGetContext($null, $null)
    while (-not $async.AsyncWaitHandle.WaitOne(500)) {
      if ($Page -and (Get-Date) -gt $deadline) { Write-Host "Timed out."; $quit = $true; break }
    }
    if ($quit) { break }
    $ctx = $listener.EndGetContext($async)
    $req = $ctx.Request
    try {
      $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)

      if ($path -eq '/__quit') { Send-Text $ctx 200 'bye'; $quit = $true; continue }

      if ($path -eq '/__log') {
        $reader = New-Object IO.StreamReader($req.InputStream)
        Write-Host ("[page] " + $reader.ReadToEnd()); Send-Text $ctx 200 'ok'; continue
      }

      if ($path -eq '/__save') {
        if (-not $SaveRoot -or $req.HttpMethod -ne 'POST') { Send-Text $ctx 403 'saving disabled'; continue }
        $rel = $req.QueryString['path']
        $base = [IO.Path]::GetFullPath($SaveRoot)
        $dest = [IO.Path]::GetFullPath((Join-Path $base $rel))
        if (-not $dest.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { Send-Text $ctx 403 'bad path'; continue }
        New-Item -ItemType Directory -Force (Split-Path -Parent $dest) | Out-Null
        $fs = [IO.File]::Create($dest); $req.InputStream.CopyTo($fs); $fs.Close()
        Write-Host "saved $rel"
        Send-Text $ctx 200 'saved'; continue
      }

      if ($path -eq '/') { $path = '/index.html' }
      $file = [IO.Path]::GetFullPath((Join-Path $Root $path.TrimStart('/')))
      if (-not $file.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $file -PathType Leaf)) {
        Send-Text $ctx 404 'not found'; continue
      }
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $type = $mime[$ext]; if (-not $type) { $type = 'application/octet-stream' }
      $bytes = [IO.File]::ReadAllBytes($file)
      $ctx.Response.ContentType = $type
      $ctx.Response.Headers.Add('Cache-Control', 'no-cache')
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      $ctx.Response.Close()
    } catch {
      try { Send-Text $ctx 500 $_.Exception.Message } catch {}
    }
  }
} finally {
  $listener.Stop()
  if ($chrome -and -not $chrome.HasExited) { Stop-Process -Id $chrome.Id -Force -ErrorAction SilentlyContinue }
}
