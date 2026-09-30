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

The `po` files pulled from the current Transifex project carry no `# Translators:` header, because the project does not export one. The people who translated STF in the original OpenSTF project (2015–2020) are therefore credited here, per language. Anonymous accounts, which Transifex lists by a hash, are omitted.

Translations made in the current project record their translator in Transifex itself.

- **German (`de`)**: 000 777 <jannicbru@gmail.com>, Dominic Wittke <dominicwittke@gmx.de>, Felix <felix.meyner@i-c-analytics.com>, Uli Wucherer <u.wucherer@gmail.com>
- **Spanish (`es`)**: Gunther Brunner, lodopidolo, Luis Calvo <lcalvo@paradigmadigital.com>, takeshimiya <takeshimiya@gmail.com>
- **French (`fr`)**: ctest 06 <ctestappleid@gmail.com>, Guillaume Chertier <gchertier.ext@orange.com>
- **Japanese (`ja`)**: Gunther Brunner, takeshimiya <takeshimiya@gmail.com>
- **Korean (`ko`)**: Dongwoo Lee <kysersoze.lee@gmail.com>, Eugene <miss0110@naver.com>
- **Polish (`pl`)**: Jacek Dwulit <jacky29@wp.pl>, Jakub Mucha <biuro@muchastudio.com.pl>, koral__, Mateusz Bartos <mbartos@wikia-inc.com>
- **Portuguese, Brazil (`pt_BR`)**: Joao Pereira <joao@jpereira.me>, John Voloski <johnvoloski@gmail.com>, Luiz Esmiralha <luiz.esmiralha@protonmail.com>, Luiz Lohn <luiz.lohn@gmail.com>
- **Russian (`ru`)**: Gumar Minibaev <gminibaev@gmail.com>, Gunnar Korneev <testgkor@gmail.com>, Kirill Kuzmichev <kkuzmichev@yandex.ru>, Kirill Zhukov <zhukov.kirill.96@gmail.com>, Petro Bilyi <whitipet@gmail.com>, Vyacheslav Frolov <frolov78@gmail.com>
- **Turkish (`tr`)**: Mucahid Gecimli <alimucahid.gecimli@egemsoft.net>, Çetin Turan <cetinturan@gmail.com>
- **Ukrainian (`uk`)**: Petro Bilyi <whitipet@gmail.com>
- **Chinese, Simplified (`zh_CN`)**: Jon Liang <jonqchk@gmail.com>, Joyyang <956090321@qq.com>, LearnShare <learnshare@126.com>, Peng Wang <buaawp@gmail.com>, qingliangcn <qing.liang.cn@gmail.com>, shengxiang <codeskyblue@gmail.com>, Ye Yorick <yexiali0791@163.com>, 培昊 何 <hepeihao524@163.com>, 戴龙飞 <dailongfei@conew.com>
- **Chinese, Traditional (`zh-Hant`)**: Can Yu <fineaisa@gmail.com>, dq wang <newbiner@gmail.com>

Some languages are in the Transifex project but not shipped in STF yet, because they are below the 80% translated that `.tx/config` requires. Their translators from the original project:

- **Czech (`cs`)**: Jiří Podhorecký <jirka.p@volny.cz>, Roman Hosek <romanhosekcz@gmail.com>
- **Danish (`da`)**: Kristian Rossen Kristensen <krossenk@gmail.com>
- **Dutch (`nl`)**: Mitchel Nijkamp <mitchelnijkamp1@msn.com>
- **Chinese, Simplified, alternative wording (`zh-Hans`)**: Booth Wang <wangbaomi@qq.com>, glovebx <ruinning@163.com>, 知秋 叶落 <droathzhiqiu90@gmail.com>
