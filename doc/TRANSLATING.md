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

The `po` files pulled from the current Transifex project carry no `# Translators:` header, because the project does not export one. The people who translated STF in the original OpenSTF project (2015–2020) are therefore credited here, per language. This covers every language of that project, shipped in STF or not, and is not updated any more. Email addresses are written as `user(at)domain`, and anonymous accounts, which Transifex lists by a hash, are omitted.

Translations made in the current project record their translator in Transifex itself.

- **Chinese, Simplified (`zh_CN`)**: Jon Liang (jonqchk(at)gmail.com), Joyyang (956090321(at)qq.com), LearnShare (learnshare(at)126.com), Peng Wang (buaawp(at)gmail.com), qingliangcn (qing.liang.cn(at)gmail.com), shengxiang (codeskyblue(at)gmail.com), Ye Yorick (yexiali0791(at)163.com), 培昊 何 (hepeihao524(at)163.com), 戴龙飞 (dailongfei(at)conew.com)
- **Chinese, Simplified (alternative wording) (`zh-Hans`)**: Booth Wang (wangbaomi(at)qq.com), glovebx (ruinning(at)163.com), 知秋 叶落 (droathzhiqiu90(at)gmail.com)
- **Chinese, Traditional (`zh-Hant`)**: Can Yu (fineaisa(at)gmail.com), dq wang (newbiner(at)gmail.com)
- **Czech (`cs`)**: Jiří Podhorecký (jirka.p(at)volny.cz), Roman Hosek (romanhosekcz(at)gmail.com)
- **Danish (`da`)**: Kristian Rossen Kristensen (krossenk(at)gmail.com)
- **Dutch (`nl`)**: Mitchel Nijkamp (mitchelnijkamp1(at)msn.com)
- **French (`fr`)**: ctest 06 (ctestappleid(at)gmail.com), Guillaume Chertier (gchertier.ext(at)orange.com)
- **German (`de`)**: 000 777 (jannicbru(at)gmail.com), Dominic Wittke (dominicwittke(at)gmx.de), Felix (felix.meyner(at)i-c-analytics.com), Uli Wucherer (u.wucherer(at)gmail.com)
- **Japanese (`ja`)**: Gunther Brunner, takeshimiya (takeshimiya(at)gmail.com)
- **Korean (`ko`)**: Dongwoo Lee (kysersoze.lee(at)gmail.com), Eugene (miss0110(at)naver.com)
- **Polish (`pl`)**: Jacek Dwulit (jacky29(at)wp.pl), Jakub Mucha (biuro(at)muchastudio.com.pl), koral__, Mateusz Bartos (mbartos(at)wikia-inc.com)
- **Portuguese, Brazil (`pt_BR`)**: Joao Pereira (joao(at)jpereira.me), John Voloski (johnvoloski(at)gmail.com), Luiz Esmiralha (luiz.esmiralha(at)protonmail.com), Luiz Lohn (luiz.lohn(at)gmail.com)
- **Russian (`ru`)**: Gumar Minibaev (gminibaev(at)gmail.com), Gunnar Korneev (testgkor(at)gmail.com), Kirill Kuzmichev (kkuzmichev(at)yandex.ru), Kirill Zhukov (zhukov.kirill.96(at)gmail.com), Petro Bilyi (whitipet(at)gmail.com), Vyacheslav Frolov (frolov78(at)gmail.com)
- **Spanish (`es`)**: Gunther Brunner, lodopidolo, Luis Calvo (lcalvo(at)paradigmadigital.com), takeshimiya (takeshimiya(at)gmail.com)
- **Turkish (`tr`)**: Mucahid Gecimli (alimucahid.gecimli(at)egemsoft.net), Çetin Turan (cetinturan(at)gmail.com)
- **Ukrainian (`uk`)**: Petro Bilyi (whitipet(at)gmail.com)
