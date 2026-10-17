# ada-app

O app de celular da ADA, em TypeScript. Conversa com a API (repo `ada-api`) pela tailnet: o celular precisa
estar no Tailscale.

O código do app mora em `src/app/`: cada arquivo ali é uma tela. A pasta `android/` é gerada pelo build,
não se edita na mão.

Tem dois jeitos de rodar o app no celular:

- **Desenvolvendo** (`npm run dev`): o celular puxa o código do Mac na hora. Mudou o código, a tela muda
  sozinha. Só funciona com o Mac ligado servindo.
- **O app de verdade** (`npm run build`): o código vai dentro de um APK que fica instalado no celular, com
  ícone, e funciona sozinho, até no 4G.

## Desenvolver

```bash
npm run dev
```

Sobe o servidor de desenvolvimento do Expo no Mac e mostra um QR no terminal. O Expo Go (app da Play Store)
lê o QR, baixa o código do Mac e roda. Cada vez que um arquivo é salvo, o Mac manda a versão nova e a tela
atualiza.

Se o celular não estiver no mesmo Wi-Fi do Mac:

```bash
REACT_NATIVE_PACKAGER_HOSTNAME=$(tailscale ip -4) npm run dev
```

O QR passa a apontar pro IP do Mac na tailnet em vez do IP do Wi-Fi, então o celular acha o Mac pelo
Tailscale de qualquer rede.

## Gerar o APK e instalar no celular

### 1. Instalar as ferramentas (uma vez só por máquina)

O build do Android não usa o Node: quem compila é o **Gradle**, que roda em Java e usa o **SDK do Android**
(as bibliotecas e ferramentas do Google). Nada disso vem com o Expo.

```bash
brew install openjdk@17
```

O Java 17, a versão que a doc do Expo pede pro build do Android. O brew deixa ele fora do PATH, então ele não
briga com outro Java que já esteja no Mac: quem aponta pra ele é o `JAVA_HOME` (abaixo e no `apk.sh`).

```bash
brew install --cask android-commandlinetools
```

Traz o `sdkmanager`, o programa que baixa as partes do SDK do Android sem precisar instalar o Android Studio.

```bash
export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
GERENTE="$(brew --prefix)/share/android-commandlinetools/cmdline-tools/latest/bin/sdkmanager"
```

A primeira diz pro `sdkmanager` usar o Java 17. A segunda só guarda o caminho do `sdkmanager` num nome curto,
pras duas linhas de baixo caberem na tela.

```bash
yes | "$GERENTE" --sdk_root="$HOME/Library/Android/sdk" --licenses
```

O Google exige aceitar as licenças do SDK antes de baixar. O `yes` responde "sim" pra cada uma.
O `--sdk_root` diz onde o SDK fica: `~/Library/Android/sdk`, o lugar padrão no Mac.

```bash
"$GERENTE" --sdk_root="$HOME/Library/Android/sdk" "platform-tools" "platforms;android-36" "build-tools;36.0.0"
```

Baixa as três partes que o build usa:
- `platform-tools`: o `adb`, que conversa com o celular pelo cabo (é com ele que o APK é instalado).
- `platforms;android-36`: o Android 16, a versão contra a qual o app é compilado (o React Native exige a 36).
- `build-tools;36.0.0`: as ferramentas que empacotam e assinam o APK.

O resto que falta (o próprio Gradle, o NDK) o build baixa sozinho na primeira vez.

### 2. Gerar o APK

```bash
npm run build
```

Roda o `apk.sh`, que faz três coisas:
1. `npx expo prebuild`: gera o projeto Android nativo (a pasta `android/`) a partir do `app.json`, com o nome,
   o ícone, o package e o http liberado.
2. `./gradlew assembleRelease`: o Gradle compila a parte nativa, empacota o código TypeScript (já convertido
   pra JS) dentro do app e gera o APK.
3. Copia o resultado pra `ada.apk`, na raiz do repo.

O primeiro build demora, porque baixa o Gradle e o NDK. Os próximos levam poucos minutos.

### 3. Ligar a depuração USB (uma vez só no celular)

Por padrão o Android não deixa um computador instalar app pelo cabo. A depuração USB libera isso.

Configurações → Sobre o telefone → Informações do software → tocar 7 vezes em **Número de compilação**.
Isso destrava as **Opções do desenvolvedor**, que o Android esconde. Depois:
Configurações → **Opções do desenvolvedor** → ligar **Depuração USB**.

### 4. Passar pro celular

Com o cabo conectado:

```bash
~/Library/Android/sdk/platform-tools/adb devices
```

Lista os celulares que o Mac está enxergando. O teu tem que aparecer como `device`. Se aparecer
`unauthorized`, o celular está perguntando se confia no Mac: aceita o aviso "Permitir depuração USB" na tela.

```bash
~/Library/Android/sdk/platform-tools/adb install -r ada.apk
```

Instala o APK no celular. O `-r` serve pra atualizar: se o app já estiver instalado, troca pela versão nova
e mantém os dados dele (o endereço da ADA salvo, por exemplo).

O `adb` vai com o caminho inteiro porque o `platform-tools` não está no PATH.

## Usar

O app só conversa: quem pensa é a ADA, no Mac. Ela tem que estar rodando e escutando na tailnet:

```bash
cd ../ada-api && ADA_HOST=$(tailscale ip -4) caffeinate -i ../core/.venv/bin/python main.py
```

- `ADA_HOST=$(tailscale ip -4)`: a API escuta no IP do Mac na tailnet, então só os aparelhos do Tailscale
  chegam nela (nunca `0.0.0.0`, que abriria pra rede toda).
- `caffeinate -i`: impede o Mac de dormir enquanto a API roda.
- `../core/.venv/bin/python main.py`: roda a API com o Python do core, que é onde estão as bibliotecas do modelo.
