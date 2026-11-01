# Builds the watch app using the Java that ships with Android Studio.
#   .\build.ps1                 -> debug build (talks to the local test database)
#   .\build.ps1 assembleRelease -> release build (talks to your real project; needs local.properties)
param([string]$Task = "assembleDebug")
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
Set-Location $PSScriptRoot
& .\gradlew.bat $Task --console=plain
exit $LASTEXITCODE
