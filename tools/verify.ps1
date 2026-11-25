# Renders test captions on every poster in headless Chrome and saves the
# results (plus side-by-side comparisons with the originals) to -OutDir.
#   powershell -ExecutionPolicy Bypass -File tools\verify.ps1 -OutDir C:\some\folder
#   ... -Only 2 -Text "YOUR CAPTION"     (one poster, custom caption)
param([Parameter(Mandatory = $true)][string]$OutDir, [string]$Only = "", [string]$Text = "")
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$q = @()
if ($Only) { $q += "only=$Only" }
if ($Text) { $q += "text=" + [Uri]::EscapeDataString($Text) }
$page = "tools/verify.html"
if ($q.Count) { $page += "?" + ($q -join "&") }
& powershell -ExecutionPolicy Bypass -File (Join-Path $root "serve.ps1") -Page $page -SaveRoot $OutDir -TimeoutSec 300
