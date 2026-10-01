# Translating STF

## Where translations live

Translations are managed in the [STF Transifex project](https://app.transifex.com/devicefarmer/stf-main) (`devicefarmer/stf-main`, resource `res..po/stf.pot (master)`, which the Transifex GitHub integration created and keeps in sync with `master`). Please translate there rather than editing the `po` files directly, so that your work is not overwritten by the next sync.

| File | Role |
| --- | --- |
| `res/common/lang/po/stf.pot` | Source strings, extracted from the UI sources. Pushed to Transifex. |
| `res/common/lang/po/stf.<lang>.po` | One catalog per language, as pulled from Transifex. |
| `res/common/lang/translations/stf.<lang>.json` | Compiled catalogs loaded by the UI. Generated from the `po` files by `node build.mts translate-compile`, which the build runs, and not committed. |
| `res/common/lang/langs.json` | Languages offered in the UI. |

Transifex language codes are used as-is for file names and `langs.json` keys. The repository used `ru_RU` and `ko_KR` before; they are now `ru` and `ko`.

See the [README](../README.md#translating) for the commands that extract, push, pull and compile.

## Machine translations

In 2026 the strings added by the React UI were filled in with machine translations, using the existing human translations as a glossary, and then cross-checked by other models. They are marked as unreviewed in Transifex. Native speakers are very welcome to review and correct them there.

## Translators

Translators are credited here rather than only in the `po` headers, in two lists: the people who translate in the current Transifex project, and those who translated in the original OpenSTF project.

### Current translators

Transifex writes the people who translated, reviewed or proofread a language into the `# Translators:` comment at the top of its `po` file. This list is generated from those comments by `node build.mts translate-contributors`, so please do not edit it by hand. Email addresses are written the same way as below. Run it after merging translations from Transifex; `lint` does not check it, since the po files Transifex sends do not update it. Strings imported in bulk are credited to whoever imported them.

<!-- translators:start -->
- **German (`de`)**: Karol Wrótniak
- **Spanish (`es`)**: Karol Wrótniak
- **French (`fr`)**: Karol Wrótniak
- **Japanese (`ja`)**: Karol Wrótniak
- **Korean (`ko`)**: Karol Wrótniak
- **Polish (`pl`)**: Karol Wrótniak
- **Brazilian Portuguese (`pt_BR`)**: Karol Wrótniak
- **Russian (`ru`)**: Karol Wrótniak
- **Turkish (`tr`)**: Karol Wrótniak
- **Ukrainian (`uk`)**: Karol Wrótniak
- **Traditional Chinese (`zh-Hant`)**: Karol Wrótniak
- **Chinese (China) (`zh_CN`)**: Karol Wrótniak
<!-- translators:end -->

### Previous translators

The people who translated STF in the original OpenSTF project (2015–2020), per language, for every language of that project whether or not it ships in STF. This list is not updated any more. Email addresses are written as `user(at)domain`, and anonymous accounts, which Transifex lists by a hash, are omitted.

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
