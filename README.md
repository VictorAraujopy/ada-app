# ada-app

O app de celular da ADA, em TypeScript: Expo (SDK 58) + Expo Router, só Android. Conversa com a API (repo
`ada-api`) pela tailnet: o celular precisa estar no Tailscale.

## O código

Cada arquivo em `src/app/` é uma tela (Expo Router). A pasta `android/` é gerada pelo build, não se edita na mão.

| Arquivo | O quê |
|---|---|
| `src/app/_layout.tsx` | carrega as fontes e monta a pilha de telas; a splash fica na tela até as fontes carregarem |
| `src/app/index.tsx` | a lista de conversas por dia, com a ficha da ADA e a prévia da última resposta (segurar uma conversa apaga; sem conexão, o motivo e o tentar de novo) |
| `src/app/conversa/[id].tsx` | o chat: a resposta chega ao vivo, com o raciocínio e as tools; o botão de imagem no campo manda uma foto (câmera ou galeria), com a miniatura antes de enviar e a foto no balão; `nova` nasce na primeira mensagem; voltou com a ADA ainda respondendo (`gerando`), pergunta de 2 em 2s até a resposta entrar |
| `src/app/terminal.tsx` | o terminal do Mac: digital (sem cair pro PIN) + senha, criada aqui na primeira vez; trava com 5 min parado ou com o app no fundo |
| `src/ada.ts` | tudo que fala com a API (o endereço do `.env.local`, os pedidos, a leitura do stream, o endereço das fotos) |
| `src/foto.ts` | pegar a foto (câmera ou galeria) e preparar: no máximo 1024 px de lado, em pé, JPEG em base64 |
| `src/componentes.tsx` | a marca (`MarcaDaAda`), o eletro, o estado da ADA e o botão de ícone |
| `src/markdown.tsx` | o markdown das respostas (bloco de código com copiar, título, lista, negrito, itálico e `código`) |
| `src/tema.ts` | as cores e as fontes |
| `app.json` | nome, package (`dev.ada.app`), ícone, splash escura, o http liberado (`usesCleartextTraffic`, a API é http pela tailnet) e o seletor de foto sem permissão de microfone |
| `assets/marca.svg` | a marca (o A com a borboleta): fonte do componente `MarcaDaAda` e dos ícones e da splash (`assets/*.png`) |

Tem dois jeitos de rodar o app no celular:

- **Desenvolvendo** (`npm run dev`): o app é instalado em modo debug pelo cabo e puxa o código do Mac na
  hora. Mudou o código, a tela muda sozinha. Só funciona com o Mac ligado servindo.
- **O app de verdade** (`npm run build`): o código vai dentro de um APK que fica instalado no celular, com
  ícone, e funciona sozinho, até no 4G.

## Desenvolver

```bash
npm run dev
```

Com o celular no cabo e a depuração USB ligada (passo 3 de "Gerar o APK"), roda o `dev.sh`, que faz três coisas:
1. `npx expo prebuild`: atualiza a pasta `android/` com o que mudou no `app.json` e nas libs.
2. `npx expo run:android`: compila o app em modo debug (só pro processador do celular conectado) e instala
   pelo cabo. É o próprio app, não o Expo Go: as permissões, a digital e o http liberado são os de verdade.
3. No fim, o próprio `run:android` liga o Metro, o servidor que entrega o JavaScript, e um túnel pelo cabo
   (`adb reverse`) pro app achar o Metro sem depender de Wi-Fi.

Cada vez que um arquivo é salvo, a tela atualiza na hora. A compilação nativa só se repete quando muda algo
nativo (lib nova, `app.json`); a primeira demora uns minutos.

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
   o ícone, o package, o http liberado e as permissões (câmera pra foto; microfone bloqueado, o app não usa).
2. `./gradlew assembleRelease`: o Gradle compila a parte nativa, empacota o código TypeScript (já convertido
   pra JS) dentro do app e gera o APK. Só pra arm64 (`-PreactNativeArchitectures=arm64-v8a`), o processador de
   todo celular Android atual: as 4 arquiteturas deixariam o build 3-4x mais lento.
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
Se o aviso não aparecer, o servidor do `adb` no Mac travou a autorização; reiniciar ele faz o celular perguntar
de novo:

```bash
~/Library/Android/sdk/platform-tools/adb kill-server && ~/Library/Android/sdk/platform-tools/adb devices
```

```bash
~/Library/Android/sdk/platform-tools/adb install -r ada.apk
```

Instala o APK no celular. O `-r` serve pra atualizar: se o app já estiver instalado, troca pela versão nova
sem desinstalar.

O `adb` vai com o caminho inteiro porque o `platform-tools` não está no PATH.

## Usar

O endereço da ADA fica no `.env.local`, na raiz do repo (fora do git), e entra no app na hora de compilar:

```bash
EXPO_PUBLIC_ADA_ENDERECO=http://<IP do Mac na tailnet>:8000
```

O app nunca mostra nem pede o IP: ao abrir ele já testa a conexão, e sem ela (Tailscale desligado, API parada,
endereço errado) a lista mostra o motivo e um botão de tentar de novo. Trocar o endereço = mudar o
`.env.local` e compilar de novo.

O app só conversa: quem pensa é a ADA, no Mac. Ela tem que estar rodando e escutando na tailnet:

```bash
cd ../ada-api && ADA_HOST=$(tailscale ip -4) caffeinate -i ../core/.venv/bin/python main.py
```

- `ADA_HOST=$(tailscale ip -4)`: a API escuta no IP do Mac na tailnet, então só os aparelhos do Tailscale
  chegam nela (nunca `0.0.0.0`, que abriria pra rede toda).
- `caffeinate -i`: impede o Mac de dormir enquanto a API roda.
- `../core/.venv/bin/python main.py`: roda a API com o Python do core, que é onde estão as bibliotecas do modelo.

O botão do terminal só aparece na lista com `ADA_TERMINAL=1` na API (ver o README do `ada-api`).
