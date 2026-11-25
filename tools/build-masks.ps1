# Rebuilds the foreground cut-outs in "Captionless Posters\masks\".
# Needs only Windows PowerShell and Chrome (or Edge): it serves the project on
# localhost and runs tools\build-masks.html in a headless browser, which writes
# the PNGs and mask-data.js back through the local server.
#
#   powershell -ExecutionPolicy Bypass -File tools\build-masks.ps1
#   powershell -ExecutionPolicy Bypass -File tools\build-masks.ps1 -Only 3   # one poster, PNG only
param([string]$Only = "")
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$page = "tools/build-masks.html"
if ($Only) { $page += "?only=$Only" }
& powershell -ExecutionPolicy Bypass -File (Join-Path $root "serve.ps1") -Page $page -SaveRoot $root -TimeoutSec 600
