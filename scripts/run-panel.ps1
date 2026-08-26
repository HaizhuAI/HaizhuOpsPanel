$ErrorActionPreference = 'Stop'
$env:PANEL_PORT = '8899'
Set-Location 'C:\data\HaizhuOpsPanel'
& 'C:\Program Files\nodejs\npm.cmd' run start:legacy
