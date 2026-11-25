@echo off
setlocal
echo ===================================================
echo SAFENEX Android Build (CLI Standalone)
echo ===================================================

if not defined JAVA_HOME (
    if exist "C:\Program Files\Android\Android Studio\jbr\bin\java.exe" (
        set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
    ) else if exist "C:\Program Files\Java\jdk-17\bin\java.exe" (
        set "JAVA_HOME=C:\Program Files\Java\jdk-17"
    ) else if exist "C:\Program Files\Eclipse Adoptium\jdk-17\bin\java.exe" (
        set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17"
    )
)

set "PATH=%JAVA_HOME%\bin;%PATH%"
if not defined ANDROID_HOME (
    if exist "%LOCALAPPDATA%\Android\Sdk" (
        set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
    )
)
set "GRADLE_OPTS=-Dorg.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m"

echo Using Java: %JAVA_HOME%
echo Using Android SDK: %ANDROID_HOME%
echo.

call .\gradlew.bat assembleDebug

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ===================================================
    echo BUILD SUCCESSFUL!
    echo APK Location:
    echo %cd%\app\build\outputs\apk\debug\app-debug.apk
    echo ===================================================
) else (
    echo.
    echo BUILD FAILED.
)
