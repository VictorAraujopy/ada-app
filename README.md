# ada-app

O app de celular da ADA, em TypeScript. Conversa com a API (repo `ada-api`) pela tailnet: o celular precisa
estar no Tailscale.

## Rodar

```bash
npm run dev     # desenvolvimento: abre no Expo Go e cada mudança aparece na hora (precisa do Mac ligado)
npm run build   # o app de verdade: gera o ada.apk, com o código dentro
~/Library/Android/sdk/platform-tools/adb install -r ada.apk   # instala no celular pelo cabo
```

O código do app mora em `src/app/`: cada arquivo ali é uma tela. A pasta `android/` é gerada pelo build,
não se edita na mão.
