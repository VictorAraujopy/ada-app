# ada-app

O app de celular da ADA, em TypeScript. Conversa com a API (repo `ada-api`) pela tailnet: o celular precisa
estar no Tailscale.

O código do app mora em `src/app/`: cada arquivo ali é uma tela. A pasta `android/` é gerada pelo build,
não se edita na mão.

## Desenvolver

```bash
npm run dev
```

Abre no Expo Go (Play Store) lendo o QR, e cada mudança no código aparece na hora. Precisa do Mac ligado
servindo o código; fora do Wi-Fi do Mac, `REACT_NATIVE_PACKAGER_HOSTNAME=$(tailscale ip -4) npm run dev`.

## Gerar o APK e instalar no celular

O APK é o app de verdade: o código vai dentro, então ele funciona sozinho, até no 4G.

**1. Uma vez só por máquina:** o JDK 17 e o SDK do Android.

```bash
brew install openjdk@17
brew install --cask android-commandlinetools
export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
GERENTE="$(brew --prefix)/share/android-commandlinetools/cmdline-tools/latest/bin/sdkmanager"
yes | "$GERENTE" --sdk_root="$HOME/Library/Android/sdk" --licenses
"$GERENTE" --sdk_root="$HOME/Library/Android/sdk" "platform-tools" "platforms;android-36" "build-tools;36.0.0"
```

**2. Gerar o APK:**

```bash
npm run build
```

Sai o `ada.apk` na raiz do repo. O primeiro demora (baixa o Gradle e o NDK); os outros, poucos minutos.

**3. Uma vez só no celular:** ligar a depuração USB.
Configurações → Sobre o telefone → Informações do software → tocar 7 vezes em **Número de compilação**.
Depois Configurações → **Opções do desenvolvedor** → ligar **Depuração USB**.

**4. Passar pro celular**, com o cabo conectado:

```bash
~/Library/Android/sdk/platform-tools/adb devices              # o celular tem que aparecer como "device"
~/Library/Android/sdk/platform-tools/adb install -r ada.apk   # instala (ou atualiza) o app
```

Se o `devices` mostrar `unauthorized`, aceita o aviso "Permitir depuração USB" na tela do celular.

## Usar

A ADA tem que estar rodando no Mac, escutando na tailnet:

```bash
cd ../ada-api && ADA_HOST=$(tailscale ip -4) caffeinate -i ../core/.venv/bin/python main.py
```
