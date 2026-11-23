$ErrorActionPreference = 'SilentlyContinue'
$sh = New-Object -ComObject WScript.Shell
$roots = @(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('CommonDesktopDirectory'),
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
  (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'),
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar')
) | Where-Object { $_ -and (Test-Path $_) }

$fixed = 0
$already = 0
foreach ($root in $roots) {
  Get-ChildItem -Path $root -Filter '*Antigravity*.lnk' -Recurse | ForEach-Object {
    $lnk = $sh.CreateShortcut($_.FullName)
    if ($lnk.TargetPath -and ($lnk.TargetPath -match 'Antigravity\.exe$')) {
      if ($lnk.Arguments -notmatch '--remote-debugging-port=') {
        $lnk.Arguments = (($lnk.Arguments + ' --remote-debugging-port=0').Trim())
        $lnk.Save()
        Write-Host "  [已修复] $($_.FullName)"
        $fixed++
      } else {
        Write-Host "  [已就绪] $($_.FullName)"
        $already++
      }
    }
  }
}

if (($fixed + $already) -eq 0) {
  Write-Host '  [提示] 未在桌面/开始菜单/任务栏找到 Antigravity 快捷方式，请手动为启动目标加上 --remote-debugging-port=0'
} else {
  Write-Host "  完成：新修复 $fixed 个，已就绪 $already 个。"
}
