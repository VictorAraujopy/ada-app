// O monitor da tela de voz, no mesmo vidro e nas mesmas cores do sinal: uma onda que vive com a fala. Ouvindo, a
// altura dela é a voz do usuário no microfone (verde); pensando, ela quase para e respira (âmbar); falando, mexe
// sozinha (verde). Com algo quebrado (a ADA fora do ar, o microfone que não abre) ela fica vermelha, como o sinal.
import { Canvas, Group, Path, Rect, RoundedRect, Skia, rect, rrect } from '@shopify/react-native-skia';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { type SharedValue, useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';

import { gradeDoMonitor, linhasDeVarredura } from '@/sinal';
import { cor } from '@/tema';

export type Fase = 'ouvindo' | 'pensando' | 'falando';

export const ALTURA_DA_ONDA = 168;
const MARGEM = 10; // a onda não encosta na borda do monitor
const PONTOS = 72; // os pontos da onda, de ponta a ponta
const VOLTAS = 9; // quantas ondas cabem na largura
const SUBIDA_MAXIMA = ALTURA_DA_ONDA * 0.42; // o quanto a onda sobe e desce do meio, no máximo
const SUAVIZAR = 0.25; // a cada quadro a onda anda 25% do caminho até a altura nova
const UMA_VOLTA_EM_S = 0.75; // o tempo que a onda leva pra correr uma volta pra esquerda

// ouvindo: um fio de onda mesmo no silêncio, e a voz por cima; fala normal (nível ~0,02 nas gravações do
// usuário) leva a onda a ~55% da altura
const FIO_NO_SILENCIO = 0.02;
const GANHO_DO_MICROFONE = 28;

// pensando: a onda quase parada, subindo e descendo devagar
const RESPIRO_ALTURA = 0.05;
const RESPIRO_VARIACAO = 0.03;
const RESPIRO_A_CADA_S = 4.4;

// falando: sílabas rápidas dentro de frases lentas, entre 30% e 75% da altura
const FALA_ALTURA = 0.3;
const FALA_VARIACAO = 0.45;
const SILABA_A_CADA_S = 1.2;
const FRASE_A_CADA_S = 3.8;

const COR_DA_FASE: Record<Fase, string> = { ouvindo: cor.vivo, pensando: cor.atencao, falando: cor.vivo };

// um seno com o período em segundos, a partir do relógio do quadro em milissegundos
function seno(agoraMs: number, periodoS: number) {
  'worklet';
  return Math.sin((2 * Math.PI * agoraMs) / (periodoS * 1000));
}

export function OndaDaVoz({ fase, nivel, vermelha }: { fase: Fase; nivel: SharedValue<number>; vermelha: boolean }) {
  const [largura, setLargura] = useState(0);
  const traco = vermelha ? cor.vermelhoTexto : COR_DA_FASE[fase];
  const grade = useMemo(() => gradeDoMonitor(largura, ALTURA_DA_ONDA), [largura]);
  const varredura = useMemo(() => linhasDeVarredura(largura, ALTURA_DA_ONDA, MARGEM), [largura]);

  // a fase vem do JavaScript; o desenho roda fora dele, então ela passa por um valor compartilhado
  const faseNoDesenho = useSharedValue<Fase>(fase);
  useEffect(() => {
    faseNoDesenho.value = fase;
  }, [fase, faseNoDesenho]);

  // a cada quadro: a altura que a onda quer ter agora, suavizada, entra na ponta direita e o resto anda pra esquerda
  const agora = useSharedValue(0);
  const altura = useSharedValue(0);
  const alturas = useSharedValue<number[]>(new Array(PONTOS).fill(0));
  const relogio = useFrameCallback((quadro) => {
    'worklet';
    const t = quadro.timestamp;
    let alvo = RESPIRO_ALTURA + RESPIRO_VARIACAO * seno(t, RESPIRO_A_CADA_S);
    if (faseNoDesenho.value === 'ouvindo') {
      alvo = FIO_NO_SILENCIO + Math.min(1 - FIO_NO_SILENCIO, nivel.value * GANHO_DO_MICROFONE);
    }
    if (faseNoDesenho.value === 'falando') {
      alvo = FALA_ALTURA + FALA_VARIACAO * Math.abs(seno(t, SILABA_A_CADA_S) * seno(t, FRASE_A_CADA_S));
    }
    altura.value += (alvo - altura.value) * SUAVIZAR;
    alturas.value = [...alturas.value.slice(1), altura.value];
    agora.value = t;
  }, false);
  useFocusEffect(
    useCallback(() => {
      relogio.setActive(true);
      return () => relogio.setActive(false);
    }, [relogio]),
  );

  // a onda: um seno que corre pra esquerda, com a altura de cada ponto vinda das alturas
  const onda = useDerivedValue(() => {
    const caminho = Skia.PathBuilder.Make();
    const passo = (largura - 2 * MARGEM) / (PONTOS - 1);
    for (let i = 0; i < PONTOS; i++) {
      const x = MARGEM + i * passo;
      const angulo = (i / PONTOS) * VOLTAS * 2 * Math.PI - (2 * Math.PI * agora.value) / (UMA_VOLTA_EM_S * 1000);
      const y = ALTURA_DA_ONDA / 2 + alturas.value[i] * SUBIDA_MAXIMA * Math.sin(angulo);
      if (i === 0) {
        caminho.moveTo(x, y);
      } else {
        caminho.lineTo(x, y);
      }
    }
    return caminho.build();
  });

  const moldura = rrect(rect(0, 0, largura, ALTURA_DA_ONDA), 12, 12);

  return (
    <View style={estilos.onda} onLayout={(evento) => setLargura(evento.nativeEvent.layout.width)}>
      {largura > 0 ? (
        <Canvas style={{ width: largura, height: ALTURA_DA_ONDA }}>
          <Group clip={moldura}>
            <Rect x={0} y={0} width={largura} height={ALTURA_DA_ONDA} color={cor.tela} />
            <Path path={grade} style="stroke" strokeWidth={0.75} color={traco} opacity={0.1} />
            <Path path={onda} style="stroke" strokeWidth={9} strokeJoin="round" color={traco} opacity={0.12} />
            <Path path={onda} style="stroke" strokeWidth={5} strokeJoin="round" color={traco} opacity={0.28} />
            <Path path={onda} style="stroke" strokeWidth={2} strokeJoin="round" color={traco} />
            <Path path={varredura} style="stroke" strokeWidth={1} color="black" opacity={0.3} />
          </Group>
          <RoundedRect
            x={0.5}
            y={0.5}
            width={largura - 1}
            height={ALTURA_DA_ONDA - 1}
            r={11.5}
            style="stroke"
            strokeWidth={1}
            color={cor.linha}
          />
        </Canvas>
      ) : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  onda: { height: ALTURA_DA_ONDA },
});
