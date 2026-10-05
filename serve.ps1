param(
    [int]$Port = 5173
)

# Static server untuk APIBayar Test App.
# Pure HTML/CSS/JS tanpa build step, jadi tidak butuh dependency apa pun.
# Pakai python kalau ada, fallback ke node.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$python = Get-Command python -ErrorAction SilentlyContinue
$node = Get-Command node -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '  APIBayar Test App'
Write-Host "  Folder : $root"
Write-Host "  URL    : http://localhost:$Port"
Write-Host '  Ctrl+C untuk berhenti'
Write-Host ''

if ($python) {
    & python -m http.server $Port
} elseif ($node) {
    & node -e "const h=require('http'),f=require('fs'),p=require('path');const m={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};h.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const t=p.join(process.cwd(),u);if(!t.startsWith(process.cwd())||!f.existsSync(t)||f.statSync(t).isDirectory()){s.writeHead(404);return s.end('Not found')}s.writeHead(200,{'Content-Type':m[p.extname(t)]||'application/octet-stream'});f.createReadStream(t).pipe(s)}).listen($Port,()=>console.log('listening on '+process.argv[1]))" $Port
} else {
    Write-Error 'Tidak ditemukan python maupun node. Buka index.html langsung lewat browser, atau install salah satu.'
}