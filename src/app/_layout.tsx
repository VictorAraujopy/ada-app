import {
  Barlow_400Regular,
  Barlow_400Regular_Italic,
  Barlow_500Medium,
  Barlow_600SemiBold,
} from '@expo-google-fonts/barlow';
import { BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { cor } from '@/tema';

// aberto a frio pelo botão de assistente (ada://voz), a pilha começa na lista: voltar da voz cai nela, não fora do app
export const unstable_settings = { initialRouteName: 'index' };

// a splash (o A sobre o preto) fica na tela até as fontes carregarem: do ícone pro app, sem tela vazia no meio
SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 300, fade: true });

export default function Layout() {
  const [fontesCarregadas] = useFonts({
    Barlow_400Regular,
    Barlow_400Regular_Italic,
    Barlow_500Medium,
    Barlow_600SemiBold,
    BarlowCondensed_700Bold,
    JetBrainsMono_400Regular,
  });

  useEffect(() => {
    if (fontesCarregadas) SplashScreen.hide();
  }, [fontesCarregadas]);

  // sem as fontes o primeiro quadro sairia na fonte do sistema e trocaria na cara de quem abre
  if (!fontesCarregadas) {
    return null;
  }

  // cada tela desenha o próprio cabeçalho (o do Android é cinza e branco)
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: cor.fundo } }} />
    </>
  );
}
