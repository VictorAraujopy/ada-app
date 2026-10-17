#!/bin/zsh
# Gera o APK de release (o app de verdade, com o código dentro) em ada.apk, na raiz do repo.
# Instalar no celular pelo cabo, com a depuração USB ligada:  adb install -r ada.apk
set -e
export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
cd "$(dirname "$0")"
npx expo prebuild --platform android
(cd android && ./gradlew assembleRelease)
cp android/app/build/outputs/apk/release/app-release.apk ada.apk
echo "pronto: $(pwd)/ada.apk"
