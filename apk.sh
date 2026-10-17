#!/bin/zsh
# npm run build: gera o APK de release (o app de verdade, com o código dentro) em ada.apk, na raiz do repo.
# Instalar no celular pelo cabo, com a depuração USB ligada:  adb install -r ada.apk
set -e
export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
cd "$(dirname "$0")"
npx expo prebuild --platform android
# só arm64: é o processador de todo celular Android atual; compilar as 4 arquiteturas deixaria o build 3-4x mais lento
(cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a)
cp android/app/build/outputs/apk/release/app-release.apk ada.apk
echo "pronto: $(pwd)/ada.apk"
