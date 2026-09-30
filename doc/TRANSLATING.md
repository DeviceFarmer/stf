# Translating STF

## Where translations live

Translations are managed in the [STF Transifex project](https://app.transifex.com/devicefarmer/stf-main) (`devicefarmer/stf-main`, resource `enpo`). Please translate there rather than editing the `po` files directly, so that your work is not overwritten by the next sync.

| File | Role |
| --- | --- |
| `res/common/lang/po/stf.pot` | Source strings, extracted from the UI sources. Pushed to Transifex. |
| `res/common/lang/po/stf.<lang>.po` | One catalog per language, as pulled from Transifex. |
| `res/common/lang/translations/stf.<lang>.json` | Compiled catalogs loaded by the UI. Generated from the `po` files. |
| `res/common/lang/langs.json` | Languages offered in the UI. |

Transifex language codes are used as-is for file names and `langs.json` keys. The repository used `ru_RU` and `ko_KR` before; they are now `ru` and `ko`.

See the [README](../README.md#translating) for the commands that extract, push, pull and compile.

## Machine translations

In 2026 the strings added by the React UI were filled in with machine translations, using the existing human translations as a glossary, and then cross-checked by other models. They are marked as unreviewed in Transifex. Native speakers are very welcome to review and correct them there.

## Translators

The `po` files pulled from the current Transifex project carry no `# Translators:` header, because the project does not export one. The people who translated STF in the original OpenSTF project (2015–2020) are therefore credited here, per language. Email addresses are left out; anonymous accounts are omitted.

Translations made in the current project record their translator in Transifex itself.

- **German (`de`)**: 000 777, Dominic Wittke, Felix, Uli Wucherer
- **Spanish (`es`)**: Gunther Brunner, lodopidolo, Luis Calvo, takeshimiya
- **French (`fr`)**: ctest 06, Guillaume Chertier
- **Japanese (`ja`)**: Gunther Brunner, takeshimiya
- **Korean (`ko`)**: Dongwoo Lee, Eugene (JINYOUNGYOO)
- **Polish (`pl`)**: Jacek Dwulit, Jakub Mucha, koral\_\_, Mateusz Bartos
- **Portuguese, Brazil (`pt_BR`)**: Joao Pereira, John Voloski, Luiz Esmiralha, Luiz Lohn
- **Russian (`ru`)**: Gumar Minibaev, Gunnar Korneev, Kirill Kuzmichev, Kirill Zhukov, Petro Bilyi, Vyacheslav Frolov
- **Turkish (`tr`)**: Çetin Turan, Mucahid Gecimli
- **Ukrainian (`uk`)**: Petro Bilyi
- **Chinese, Simplified (`zh_CN`)**: Booth Wang, glovebx, Jon Liang, Joyyang (凯允 杨), LearnShare, Peng Wang, qingliangcn, shengxiang, Ye Yorick, 培昊 何, 戴龙飞, 知秋 叶落
- **Chinese, Traditional (`zh-Hant`)**: Can Yu, dq wang

Languages that existed only in the original project and are not in STF today had their own contributors, who are credited on the [legacy project](https://app.transifex.com/openstf/stf/): Czech (Jiří Podhorecký, Roman Hosek), Danish (Kristian Rossen Kristensen) and Dutch (Mitchel Nijkamp).
