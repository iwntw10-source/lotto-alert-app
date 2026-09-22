# 복권 알림이 — 서명 키 생성 + 서명된 AAB 빌드 (한 번에)
#   PowerShell에서:  powershell -ExecutionPolicy Bypass -File tools\make-keystore-and-build.ps1
# 비밀번호는 실행 중에 직접 입력합니다. 이 스크립트는 비밀번호를 어디에도 기록하지 않고,
# android\keystore.properties (git 제외 파일)에만 저장합니다.
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [securestring]$Password,   # 테스트용. 생략하면 입력창이 뜹니다
  [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'

$jdk      = 'C:\Users\jski1\.jdks\jbr-21.0.11'
$keytool  = Join-Path $jdk 'bin\keytool.exe'
$jarsign  = Join-Path $jdk 'bin\jarsigner.exe'
$android  = Join-Path $Root 'android'
$jks      = Join-Path $android 'upload-keystore.jks'
$props    = Join-Path $android 'keystore.properties'
$aab      = Join-Path $android 'app\build\outputs\bundle\release\app-release.aab'
$outAab   = Join-Path $env:USERPROFILE 'Downloads\lotto-alert-v1-release.aab'

if (-not (Test-Path $keytool)) { throw "keytool 을 찾을 수 없어요: $keytool (JDK 경로 확인)" }

function ToPlain([securestring]$s) {
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

# ---------- 1) 키스토어 ----------
if (Test-Path $jks) {
  Write-Host "이미 키스토어가 있어요: $jks (덮어쓰지 않고 그대로 사용합니다)" -ForegroundColor Yellow
  if (-not (Test-Path $props)) { throw "keystore.properties 가 없어요. android\keystore.properties.example 을 복사해서 채워 주세요." }
} else {
  Write-Host ""
  Write-Host "서명 키를 새로 만듭니다." -ForegroundColor Cyan
  Write-Host " - 비밀번호: 영문/숫자/!@#^*_+.~- 만, 8자 이상 (공백·따옴표·백슬래시 금지)"
  Write-Host " - 이 비밀번호는 꼭 메모해 두세요. 잃어버리면 앱 업데이트를 못 올립니다."
  if ($Password) { $p1 = ToPlain $Password }
  else {
    $s1 = Read-Host '키스토어 비밀번호' -AsSecureString
    $s2 = Read-Host '한 번 더 입력' -AsSecureString
    $p1 = ToPlain $s1
    if ($p1 -cne (ToPlain $s2)) { throw '두 번 입력한 비밀번호가 달라요. 다시 실행해 주세요.' }
  }
  if ($p1 -notmatch '^[A-Za-z0-9!@#^*_+.~-]{8,}$') { throw '비밀번호 형식이 맞지 않아요 (영문/숫자/!@#^*_+.~- 만, 8자 이상).' }

  & $keytool -genkeypair -keystore $jks -alias upload -keyalg RSA -keysize 2048 -validity 10000 `
    -storepass $p1 -keypass $p1 -dname 'CN=Lotto Alert, OU=App, O=Personal, L=Seoul, C=KR'
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $jks)) { throw '키스토어 생성에 실패했어요.' }

  @(
    'storeFile=upload-keystore.jks',
    "storePassword=$p1",
    'keyAlias=upload',
    "keyPassword=$p1"
  ) | Set-Content -Path $props -Encoding ASCII
  Write-Host "키스토어와 keystore.properties 를 만들었어요." -ForegroundColor Green
}

if ($SkipBuild) { Write-Host '(-SkipBuild: 빌드는 건너뜁니다)'; return }

# ---------- 2) 빌드 ----------
$env:JAVA_HOME = $jdk
Push-Location $Root
try {
  if (Get-Command npx -ErrorAction SilentlyContinue) { npx cap sync android }
  Push-Location $android
  try { & .\gradlew.bat bundleRelease; if ($LASTEXITCODE -ne 0) { throw 'AAB 빌드에 실패했어요.' } } finally { Pop-Location }
} finally { Pop-Location }

# ---------- 3) 서명 확인 + 복사 ----------
$v = & $jarsign -verify $aab 2>&1 | Out-String
if ($v -notmatch 'jar verified') { throw "AAB 서명이 확인되지 않아요:`n$v" }
Copy-Item $aab $outAab -Force

Write-Host ""
Write-Host "완료! 서명된 AAB: $outAab" -ForegroundColor Green
Write-Host "  -> Play Console 내부 테스트 > 새 버전 만들기 에서 이 파일을 올리세요."
Write-Host ""
Write-Host "꼭 백업하세요 (2곳 이상: USB + 비밀번호 관리자):" -ForegroundColor Yellow
Write-Host "  $jks"
Write-Host "  + 방금 입력한 비밀번호"
