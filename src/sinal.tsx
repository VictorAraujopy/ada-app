// O sinal da tela inicial: o monitor cardíaco da tela de status do RE.
// A linha inteira fica parada; o que anda é a cabeça e a máscara que mostra só o rastro atrás dela.
import {
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Mask,
  Path,
  Rect,
  RoundedRect,
  rect,
  rrect,
  vec,
} from '@shopify/react-native-skia';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';

import { cor } from '@/tema';

export const ALTURA_DO_SINAL = 44; // a altura do BotaoIcone, pra linha do topo fechar
const VARREDURA_MS = 3000; // a cabeça atravessa o monitor em 3 s
const RASTRO = 0.7; // o rastro apaga ao longo de 70% da largura
const MARGEM = 6; // a linha não encosta na borda do monitor
const BASE = ALTURA_DO_SINAL * 0.6; // a linha reta fica um pouco abaixo do meio
const AMPLITUDE = ALTURA_DO_SINAL * 0.36; // o quanto o pico sobe

// uma batida, [onde no x (0 a 1), altura (-1 = o pico)]: a onda P, o pico do QRS e a onda T
const BATIDA: [number, number][] = [
  [0, 0],
  [0.28, 0],
  [0.32, -0.1],
  [0.36, 0],
  [0.42, 0],
  [0.45, 0.15],
  [0.5, -1],
  [0.55, 0.45],
  [0.59, 0],
  [0.7, 0],
  [0.76, -0.22],
  [0.82, 0],
  [1, 0],
];

// do fim do rastro (apagado) até a cabeça (aceso), apagando em curva como o fósforo de um monitor antigo
const APAGAR_DO_RASTRO = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.13)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.65)', 'rgba(0,0,0,1)'];

// a cor do traço, o miolo claro da cabeça e quantas batidas cabem numa varredura (3, 5, 7 = 60, 100, 140 bpm)
function sinalDoEstado(estado: string) {
  if (estado === 'pronta') return { traco: cor.vivo, miolo: '#E6FFEE', batidas: 3 };
  if (estado === 'fora do ar') return { traco: cor.vermelhoTexto, miolo: '#FFE0E2', batidas: 7 };
  if (estado === '…') return { traco: cor.apagado, miolo: cor.texto, batidas: 3 };
  return { traco: cor.atencao, miolo: '#FFF1DA', batidas: 5 };
}

// a linha inteira, de ponta a ponta do monitor
function linhaDoSinal(largura: number, batidas: number) {
  const larguraDaBatida = (largura - 2 * MARGEM) / batidas;
  const pontos: string[] = [];
  for (let b = 0; b < batidas; b++) {
    for (const [x, y] of BATIDA) {
      pontos.push(`${MARGEM + (b + x) * larguraDaBatida} ${BASE + y * AMPLITUDE}`);
    }
  }
  return `M ${pontos.join(' L ')}`;
}

// o quadriculado do monitor: uma linha a cada 16 na vertical e a cada 12 na horizontal
function gradeDoMonitor(largura: number) {
  const linhas: string[] = [];
  for (let x = 16; x < largura; x += 16) linhas.push(`M ${x} 0 V ${ALTURA_DO_SINAL}`);
  for (let y = 12; y < ALTURA_DO_SINAL; y += 12) linhas.push(`M 0 ${y} H ${largura}`);
  return linhas.join(' ');
}

// as linhas escuras a cada 3, por cima de tudo, como numa tela de tubo
function linhasDeVarredura(largura: number) {
  const linhas: string[] = [];
  for (let y = MARGEM; y <= ALTURA_DO_SINAL - MARGEM; y += 3) linhas.push(`M ${MARGEM} ${y} H ${largura - MARGEM}`);
  return linhas.join(' ');
}

// a altura da linha num ponto da batida (u de 0 a 1), ligando os pontos da BATIDA em reta
function alturaNaBatida(u: number) {
  'worklet';
  for (let i = 1; i < BATIDA.length; i++) {
    const [x0, y0] = BATIDA[i - 1];
    const [x1, y1] = BATIDA[i];
    if (u <= x1) return y0 + ((y1 - y0) * (u - x0)) / (x1 - x0);
  }
  return 0;
}

export function SinalDaAda({ estado }: { estado: string }) {
  const [largura, setLargura] = useState(0);
  const { traco, miolo, batidas } = sinalDoEstado(estado);
  const larguraDaLinha = largura - 2 * MARGEM;
  const comprimentoDoRastro = larguraDaLinha * RASTRO;

  const linha = useMemo(() => linhaDoSinal(largura, batidas), [largura, batidas]);
  const grade = useMemo(() => gradeDoMonitor(largura), [largura]);
  const varredura = useMemo(() => linhasDeVarredura(largura), [largura]);

  // o relógio anda a cada quadro, fora do JavaScript, e só com a tela na frente
  const agora = useSharedValue(0);
  const relogio = useFrameCallback((quadro) => {
    'worklet';
    agora.value = quadro.timestamp;
  }, false);
  useFocusEffect(
    useCallback(() => {
      relogio.setActive(true);
      return () => relogio.setActive(false);
    }, [relogio]),
  );

  // a cabeça: o x vem da fase da varredura, o y da altura da batida naquele ponto
  const cabecaX = useDerivedValue(() => {
    const fase = (agora.value % VARREDURA_MS) / VARREDURA_MS;
    return MARGEM + fase * larguraDaLinha;
  });
  const cabecaY = useDerivedValue(() => {
    const fase = (agora.value % VARREDURA_MS) / VARREDURA_MS;
    const ondeNaBatida = (fase * batidas) % 1;
    return BASE + alturaNaBatida(ondeNaBatida) * AMPLITUDE;
  });

  // a faixa da máscara vai do fim do rastro até a cabeça, e o degradê dela é o rastro apagando
  const rastroX = useDerivedValue(() => cabecaX.value - comprimentoDoRastro);
  const rastroComeco = useDerivedValue(() => vec(rastroX.value, 0));
  const rastroFim = useDerivedValue(() => vec(cabecaX.value, 0));
  const faixaDoRastro = (
    <Rect x={rastroX} y={0} width={comprimentoDoRastro} height={ALTURA_DO_SINAL}>
      <LinearGradient start={rastroComeco} end={rastroFim} colors={APAGAR_DO_RASTRO} />
    </Rect>
  );
  // quando a cabeça volta pro começo, o fim do rastro ainda está no fim do monitor: a mesma faixa, uma volta à direita
  const rastroComAVolta = (
    <Group>
      {faixaDoRastro}
      <Group transform={[{ translateX: larguraDaLinha }]}>{faixaDoRastro}</Group>
    </Group>
  );

  const moldura = rrect(rect(0, 0, largura, ALTURA_DO_SINAL), 12, 12);

  return (
    <View
      style={estilos.sinal}
      onLayout={(evento) => setLargura(evento.nativeEvent.layout.width)}
      accessible
      accessibilityLabel={`ADA ${estado}`}
    >
      {largura > 0 ? (
        <Canvas style={{ width: largura, height: ALTURA_DO_SINAL }}>
          <Group clip={moldura}>
            <Rect x={0} y={0} width={largura} height={ALTURA_DO_SINAL} color={cor.tela} />
            <Path path={grade} style="stroke" strokeWidth={0.75} color={traco} opacity={0.1} />
            <Mask mask={rastroComAVolta}>
              <Path path={linha} style="stroke" strokeWidth={8} strokeJoin="round" color={traco} opacity={0.12} />
              <Path path={linha} style="stroke" strokeWidth={4.5} strokeJoin="round" color={traco} opacity={0.28} />
              <Path path={linha} style="stroke" strokeWidth={2} strokeJoin="round" color={traco} />
            </Mask>
            <Circle cx={cabecaX} cy={cabecaY} r={8} color={traco} opacity={0.15} />
            <Circle cx={cabecaX} cy={cabecaY} r={4.5} color={traco} opacity={0.4} />
            <Circle cx={cabecaX} cy={cabecaY} r={2} color={miolo} />
            <Path path={varredura} style="stroke" strokeWidth={1} color="black" opacity={0.3} />
          </Group>
          <RoundedRect
            x={0.5}
            y={0.5}
            width={largura - 1}
            height={ALTURA_DO_SINAL - 1}
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
  sinal: { flex: 1, height: ALTURA_DO_SINAL },
});
