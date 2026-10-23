# Читает текущий трек из системной панели мультимедиа Windows (её заполняют Spotify, Яндекс Музыка, браузеры)
# и печатает его одной строкой JSON раз в две секунды. Команды со стандартного входа: toggle, next, prev.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, [Type]$type) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $null = $t.Wait(5000)
  return $t.Result
}
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$mgr = Await ($mgrType::RequestAsync()) $mgrType
# Console.In читает синхронно даже через ReadLineAsync, поэтому читаем поток напрямую.
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
$last = ''
$tick = 0
while ($true) {
  if ($pending.IsCompleted) {
    $cmd = $pending.Result
    if ($null -eq $cmd) { exit 0 }
    $s = $mgr.GetCurrentSession()
    if ($s) {
      try {
        switch ($cmd.Trim()) {
          'toggle' { $null = Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
          'next' { $null = Await ($s.TrySkipNextAsync()) ([bool]) }
          'prev' { $null = Await ($s.TrySkipPreviousAsync()) ([bool]) }
        }
      } catch { }
    }
    $pending = $stdin.ReadLineAsync()
    $tick = 8
  }
  if ($tick -ge 8) {
    $tick = 0
    $out = '{}'
    try {
      $s = $mgr.GetCurrentSession()
      if ($s) {
        $p = Await ($s.TryGetMediaPropertiesAsync()) $propsType
        $tl = $s.GetTimelineProperties()
        $out = [pscustomobject]@{
          app = [string]$s.SourceAppUserModelId; title = [string]$p.Title; artist = [string]$p.Artist; album = [string]$p.AlbumTitle
          status = [string]$s.GetPlaybackInfo().PlaybackStatus; pos = [math]::Round($tl.Position.TotalSeconds); dur = [math]::Round($tl.EndTime.TotalSeconds)
        } | ConvertTo-Json -Compress
      }
    } catch { $out = '{}' }
    if ($out -ne $last) { [Console]::Out.WriteLine($out); [Console]::Out.Flush(); $last = $out }
  }
  Start-Sleep -Milliseconds 250
  $tick++
}
