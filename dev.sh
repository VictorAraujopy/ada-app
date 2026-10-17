#!/bin/zsh
# npm run dev: compila o app em modo debug, instala no celular pelo cabo e liga o Metro (mudou o código, a tela muda).
# O nativo só recompila quando muda (lib nova, app.json); o resto é recarga na hora. Precisa da depuração USB ligada.
set -e
export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
cd "$(dirname "$0")"
npx expo prebuild --platform android
npx expo run:android
