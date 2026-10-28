// A ADA como assistente do Android: o filtro android.intent.action.ASSIST na tela principal faz o Android listar
// ela como assistente padrão (Configurações > Apps padrão > Assistente digital), e a MainActivity troca esse
// pedido pelo link ada://voz, que o Expo Router abre na tela de voz.
// O código vai na MainActivity pelas ferramentas do próprio Expo (as mesmas do expo-splash-screen): blocos
// marcados @generated, que o prebuild troca quando o código daqui muda, sem duplicar.
const { AndroidConfig, CodeGenerator, withAndroidManifest, withMainActivity } = require('expo/config-plugins');

const { addImports } = AndroidConfig.CodeMod;
const { mergeContents } = CodeGenerator;

const FILTRO_DE_ASSISTENTE = {
  action: [{ $: { 'android:name': 'android.intent.action.ASSIST' } }],
  category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
};

const FUNCOES_DA_VOZ = `  // o botão de assistente chega como ACTION_ASSIST, que o React Native não entrega pro JavaScript:
  // vira o link ada://voz, que o Expo Router abre na tela de voz
  private fun abrirAVozSeVeioDoAssistente(intent: Intent?) {
    if (intent?.action == Intent.ACTION_ASSIST) {
      intent.action = Intent.ACTION_VIEW
      intent.data = Uri.parse("ada://voz")
    }
  }

  override fun onNewIntent(intent: Intent) {
    abrirAVozSeVeioDoAssistente(intent)
    super.onNewIntent(intent)
  }
`;

function comOFiltroDeAssistente(config) {
  return withAndroidManifest(config, (configComManifesto) => {
    const aplicativo = configComManifesto.modResults.manifest.application[0];
    const telaPrincipal = aplicativo.activity.find((tela) => tela.$['android:name'] === '.MainActivity');
    const filtros = telaPrincipal['intent-filter'];
    const jaTem = filtros.some((filtro) =>
      (filtro.action ?? []).some((acao) => acao.$['android:name'] === 'android.intent.action.ASSIST'),
    );
    if (!jaTem) {
      filtros.push(FILTRO_DE_ASSISTENTE);
    }
    return configComManifesto;
  });
}

function comOAssistenteAbrindoAVoz(config) {
  return withMainActivity(config, (configComTela) => {
    const comImports = addImports(configComTela.modResults.contents, ['android.content.Intent', 'android.net.Uri'], false);
    const comAsFuncoes = mergeContents({
      src: comImports,
      newSrc: FUNCOES_DA_VOZ,
      tag: 'ada-assistente-funcoes',
      anchor: /class MainActivity : ReactActivity\(\) \{/,
      offset: 1,
      comment: '  //',
    });
    const comAChamada = mergeContents({
      src: comAsFuncoes.contents,
      newSrc: '    abrirAVozSeVeioDoAssistente(intent)',
      tag: 'ada-assistente-oncreate',
      anchor: /override fun onCreate\(savedInstanceState: Bundle\?\) \{/,
      offset: 1,
      comment: '    //',
    });
    configComTela.modResults.contents = comAChamada.contents;
    return configComTela;
  });
}

module.exports = function pluginAssistente(config) {
  return comOAssistenteAbrindoAVoz(comOFiltroDeAssistente(config));
};
