// A fala da ADA na tela de voz: a resposta dita frase por frase, numa voz local do Android (o texto não sai
// do celular).
import * as Speech from 'expo-speech';

// a voz que o usuário escolheu ouvindo as 23 vozes locais em inglês do celular
const VOZ_PREFERIDA = 'en-gb-x-gbc-local';

// a voz local em inglês: a preferida, senão qualquer outra que rode no aparelho; as "-network" mandariam o texto
// pro Google, então sem voz local a ADA não fala (null). A lista às vezes vem vazia enquanto o motor de voz liga
export async function escolherVoz() {
  let vozes = await Speech.getAvailableVoicesAsync();
  if (vozes.length === 0) {
    await new Promise((esperou) => setTimeout(esperou, 1500));
    vozes = await Speech.getAvailableVoicesAsync();
  }
  const locais = vozes.filter((voz) => voz.language.startsWith('en') && voz.identifier.endsWith('-local'));
  return locais.find((voz) => voz.identifier === VOZ_PREFERIDA) ?? locais[0] ?? null;
}

// o que não se fala: o bloco de código sai inteiro; asterisco, crase, cerquilha e marcador de lista somem,
// e o link vira só o texto dele
function praFalar(texto: string) {
  return texto
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/[*_`#>]/g, '')
    .trim();
}

// um bloco de código aberto e ainda não fechado: espera ele fechar pra não falar linha de código
function temCodigoAberto(texto: string) {
  const cercas = texto.match(/```/g) ?? [];
  return cercas.length % 2 === 1;
}

// os blocos de código já fechados saem inteiros, antes de cortar em frases (senão a quebra de linha de dentro
// do bloco fecharia uma "frase" e cada linha de código seria falada)
function semOsBlocosFechados(texto: string) {
  return texto.replace(/```[\s\S]*?```/g, ' ');
}

// fala a resposta conforme ela chega: cada frase completa (até . ! ? seguido de espaço, ou até a quebra de linha)
// entra na fila do motor de voz do Android. aoTerminar vem depois da última frase falada
export function criarFala(voz: Speech.Voice, aoTerminar: () => void) {
  let sobra = '';
  let naFila = 0;
  let chegouTudo = false;
  let parada = false;

  function terminouUma() {
    naFila -= 1;
    if (!parada && chegouTudo && naFila === 0) aoTerminar();
  }

  // depois do parar() nada mais é falado: o stream da resposta pode continuar chegando com a tela fechada.
  // O motor de voz recusa texto acima de maxSpeechInputLength sem avisar: uma frase gigante vai em partes
  function falar(frase: string) {
    const limpa = praFalar(frase);
    if (parada || !limpa) return;
    for (let inicio = 0; inicio < limpa.length; inicio += Speech.maxSpeechInputLength) {
      naFila += 1;
      Speech.speak(limpa.slice(inicio, inicio + Speech.maxSpeechInputLength), {
        voice: voz.identifier,
        language: voz.language,
        onDone: terminouUma,
        onStopped: terminouUma,
        onError: terminouUma,
      });
    }
  }

  function receber(pedacoDaResposta: string) {
    sobra += pedacoDaResposta;
    if (temCodigoAberto(sobra)) return;
    sobra = semOsBlocosFechados(sobra);
    let fimDaFrase = sobra.search(/[.!?]\s|\n/);
    while (fimDaFrase >= 0) {
      falar(sobra.slice(0, fimDaFrase + 1));
      sobra = sobra.slice(fimDaFrase + 1);
      fimDaFrase = sobra.search(/[.!?]\s|\n/);
    }
  }

  // um bloco de código que nunca fechou (a resposta acabou no meio dele) não é falado
  function terminar() {
    chegouTudo = true;
    if (temCodigoAberto(sobra)) {
      sobra = sobra.slice(0, sobra.lastIndexOf('```'));
    }
    falar(sobra);
    sobra = '';
    if (!parada && naFila === 0) aoTerminar();
  }

  function parar() {
    parada = true;
    Speech.stop();
  }

  return { receber, terminar, parar };
}
