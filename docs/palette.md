# Палитра Holst: токены → hex

Карта внутренних имён цветов (токенов) Holst в hex. Извлечена из бандла
приложения (light theme — та, что используется на доске): main `5bac99c5` /
vendor `1393c507`, 2026-10-19. Тот же источник — селектор цветов UI.

## Зачем этот файл

- **MCP-интерфейс принимает только `#RRGGBB`** — имена токенов из API убраны (v0.6.0):
  токен и его hex-значение рендерятся идентично (проверено попиксельно), имена лишь путали клиентов.
- Объекты, созданные **вручную через UI Holst**, хранят в yDoc имена токенов; `get_board_content`
  транслирует их в hex на чтении (таблица-генерат `src/palette-data.js`, источник — этот файл).
- Подбор цветов для новых объектов: hex-значения ниже можно передавать напрямую.

## Нюанс рендера

Holst рисует насыщенные цвета «гармонизированными» (тон сохраняется ±5°, насыщенность
ниже, светлота тянется к ~57–62%) — одинаково для токенов и hex, детерминированно.
Бледные (l ≳ 85%), тёмные (l ≲ 25%) и серые (s ≈ 0) проходят дословно.
Примеры: `#e54d2e → #d4583b`, `#6e56cf → #6a57c8`, `#f5f5f5 → #f5f5f5`, `#ffffff → #ffffff`.

Замечания: `white1..white12` — все чистый белый. Коллизия `gray2`: **тема** (карта ниже) определяет `gray2 = #f9f9f9`, но **пикер UI** при выборе серого шага 2 записывает токен `white3` — т.е. объект с «серым-2» из UI читается как `white3` (#ffffff).

## Карта

### white

| Токен | Hex |
|---|---|
| `white1` | `#ffffff` |
| `white2` | `#ffffff` |
| `white3` | `#ffffff` |
| `white4` | `#ffffff` |
| `white5` | `#ffffff` |
| `white6` | `#ffffff` |
| `white7` | `#ffffff` |
| `white8` | `#ffffff` |
| `white9` | `#ffffff` |
| `white10` | `#ffffff` |
| `white11` | `#ffffff` |
| `white12` | `#ffffff` |

### gray

| Токен | Hex |
|---|---|
| `gray1` | `#fcfcfc` |
| `gray2` | `#f9f9f9` |
| `gray3` | `#f1f1f1` |
| `gray4` | `#ebebeb` |
| `gray5` | `#e4e4e4` |
| `gray6` | `#dddddd` |
| `gray7` | `#d4d4d4` |
| `gray8` | `#b2b2b2` |
| `gray9` | `#8d8d8d` |
| `gray10` | `#808080` |
| `gray11` | `#171717` |
| `gray12` | `#202020` |

### tomato

| Токен | Hex |
|---|---|
| `tomato1` | `#fffcfc` |
| `tomato2` | `#fff8f7` |
| `tomato3` | `#fff0ee` |
| `tomato4` | `#ffe6e2` |
| `tomato5` | `#fdd8d3` |
| `tomato6` | `#fac7be` |
| `tomato7` | `#f3b0a2` |
| `tomato8` | `#ea9280` |
| `tomato9` | `#e54d2e` |
| `tomato10` | `#d84224` |
| `tomato11` | `#c33113` |
| `tomato12` | `#5c271f` |

### red

| Токен | Hex |
|---|---|
| `red1` | `#fffcfc` |
| `red2` | `#fff7f7` |
| `red3` | `#ffefef` |
| `red4` | `#ffe5e5` |
| `red5` | `#fdd8d8` |
| `red6` | `#f9c6c6` |
| `red7` | `#f3aeaf` |
| `red8` | `#eb9091` |
| `red9` | `#e5484d` |
| `red10` | `#d93d42` |
| `red11` | `#c62a2f` |
| `red12` | `#641723` |

### crimson

| Токен | Hex |
|---|---|
| `crimson1` | `#fffcfd` |
| `crimson2` | `#fff7fb` |
| `crimson3` | `#feeff6` |
| `crimson4` | `#fce5f0` |
| `crimson5` | `#f9d8e7` |
| `crimson6` | `#f4c6db` |
| `crimson7` | `#edadc8` |
| `crimson8` | `#e58fb1` |
| `crimson9` | `#e93d82` |
| `crimson10` | `#dc3175` |
| `crimson11` | `#cb1d63` |
| `crimson12` | `#621639` |

### pink

| Токен | Hex |
|---|---|
| `pink1` | `#fffcfe` |
| `pink2` | `#fff7fc` |
| `pink3` | `#feeef8` |
| `pink4` | `#fce5f3` |
| `pink5` | `#f9d8ec` |
| `pink6` | `#f3c6e2` |
| `pink7` | `#ecadd4` |
| `pink8` | `#e38ec3` |
| `pink9` | `#d6409f` |
| `pink10` | `#cd3093` |
| `pink11` | `#c41c87` |
| `pink12` | `#651249` |

### plum

| Токен | Hex |
|---|---|
| `plum1` | `#fefcff` |
| `plum2` | `#fff8ff` |
| `plum3` | `#fceffc` |
| `plum4` | `#f9e5f9` |
| `plum5` | `#f3d9f4` |
| `plum6` | `#ebc8ed` |
| `plum7` | `#dfafe3` |
| `plum8` | `#cf91d8` |
| `plum9` | `#ab4aba` |
| `plum10` | `#a43cb4` |
| `plum11` | `#9c2bad` |
| `plum12` | `#53195d` |

### purple

| Токен | Hex |
|---|---|
| `purple1` | `#fefcfe` |
| `purple2` | `#fdfaff` |
| `purple3` | `#f9f1fe` |
| `purple4` | `#f3e7fc` |
| `purple5` | `#eddbf9` |
| `purple6` | `#e3ccf4` |
| `purple7` | `#d3b4ed` |
| `purple8` | `#be93e4` |
| `purple9` | `#8e4ec6` |
| `purple10` | `#8445bc` |
| `purple11` | `#793aaf` |
| `purple12` | `#402060` |

### violet

| Токен | Hex |
|---|---|
| `violet1` | `#fdfcfe` |
| `violet2` | `#fbfaff` |
| `violet3` | `#f5f2ff` |
| `violet4` | `#ede9fe` |
| `violet5` | `#e4defc` |
| `violet6` | `#d7cff9` |
| `violet7` | `#c4b8f3` |
| `violet8` | `#aa99ec` |
| `violet9` | `#6e56cf` |
| `violet10` | `#644fc1` |
| `violet11` | `#5746af` |
| `violet12` | `#2f265f` |

### indigo

| Токен | Hex |
|---|---|
| `indigo1` | `#fdfdfe` |
| `indigo2` | `#f8faff` |
| `indigo3` | `#f0f4ff` |
| `indigo4` | `#e6edfe` |
| `indigo5` | `#d9e2fc` |
| `indigo6` | `#c6d4f9` |
| `indigo7` | `#aec0f5` |
| `indigo8` | `#8da4ef` |
| `indigo9` | `#3e63dd` |
| `indigo10` | `#3a5ccc` |
| `indigo11` | `#3451b2` |
| `indigo12` | `#1f2d5c` |

### blue

| Токен | Hex |
|---|---|
| `blue1` | `#fbfdff` |
| `blue2` | `#f5faff` |
| `blue3` | `#edf6ff` |
| `blue4` | `#e1f0ff` |
| `blue5` | `#cee7fe` |
| `blue6` | `#b7d9f8` |
| `blue7` | `#96c7f2` |
| `blue8` | `#5eb0ef` |
| `blue9` | `#0090ff` |
| `blue10` | `#0880ea` |
| `blue11` | `#0b68cb` |
| `blue12` | `#113264` |

### cyan

| Токен | Hex |
|---|---|
| `cyan1` | `#fafdfe` |
| `cyan2` | `#f2fcfd` |
| `cyan3` | `#e7f9fb` |
| `cyan4` | `#d8f3f6` |
| `cyan5` | `#c4eaef` |
| `cyan6` | `#aadee6` |
| `cyan7` | `#84cdda` |
| `cyan8` | `#3db9cf` |
| `cyan9` | `#05a2c2` |
| `cyan10` | `#0894b3` |
| `cyan11` | `#0c7792` |
| `cyan12` | `#0d3c48` |

### teal

| Токен | Hex |
|---|---|
| `teal1` | `#fafefd` |
| `teal2` | `#f1fcfa` |
| `teal3` | `#e7f9f5` |
| `teal4` | `#d9f3ee` |
| `teal5` | `#c7ebe5` |
| `teal6` | `#afdfd7` |
| `teal7` | `#8dcec3` |
| `teal8` | `#53b9ab` |
| `teal9` | `#12a594` |
| `teal10` | `#0e9888` |
| `teal11` | `#067a6f` |
| `teal12` | `#0d3d38` |

### jade

| Токен | Hex |
|---|---|
| `jade1` | `#fbfefd` |
| `jade2` | `#effdf6` |
| `jade3` | `#e4faef` |
| `jade4` | `#d7f4e6` |
| `jade5` | `#c6ecdb` |
| `jade6` | `#b0e0cc` |
| `jade7` | `#8fcfb9` |
| `jade8` | `#56ba9f` |
| `jade9` | `#29a383` |
| `jade10` | `#259678` |
| `jade11` | `#1a7a5e` |
| `jade12` | `#1d3b31` |

### green

| Токен | Hex |
|---|---|
| `green1` | `#fbfefc` |
| `green2` | `#f2fcf5` |
| `green3` | `#e9f9ee` |
| `green4` | `#ddf3e4` |
| `green5` | `#ccebd7` |
| `green6` | `#b4dfc4` |
| `green7` | `#92ceac` |
| `green8` | `#5bb98c` |
| `green9` | `#30a46c` |
| `green10` | `#299764` |
| `green11` | `#18794e` |
| `green12` | `#193b2d` |

### grass

| Токен | Hex |
|---|---|
| `grass1` | `#fbfefb` |
| `grass2` | `#f3fcf3` |
| `grass3` | `#ebf9eb` |
| `grass4` | `#dff3df` |
| `grass5` | `#ceebcf` |
| `grass6` | `#b7dfba` |
| `grass7` | `#97cf9c` |
| `grass8` | `#65ba75` |
| `grass9` | `#46a758` |
| `grass10` | `#3d9a50` |
| `grass11` | `#297c3b` |
| `grass12` | `#203c25` |

### brown

| Токен | Hex |
|---|---|
| `brown1` | `#fefdfc` |
| `brown2` | `#fcf9f6` |
| `brown3` | `#f8f1ea` |
| `brown4` | `#f4e9dd` |
| `brown5` | `#efddcc` |
| `brown6` | `#e8cdb5` |
| `brown7` | `#ddb896` |
| `brown8` | `#d09e72` |
| `brown9` | `#ad7f58` |
| `brown10` | `#9e7352` |
| `brown11` | `#815e46` |
| `brown12` | `#3e332e` |

### sky

| Токен | Hex |
|---|---|
| `sky1` | `#f9feff` |
| `sky2` | `#f1fcff` |
| `sky3` | `#e2f9ff` |
| `sky4` | `#d2f4fd` |
| `sky5` | `#bfebf8` |
| `sky6` | `#a5dced` |
| `sky7` | `#82cae0` |
| `sky8` | `#46b8d8` |
| `sky9` | `#7ce2fe` |
| `sky10` | `#72dbf8` |
| `sky11` | `#256e93` |
| `sky12` | `#19404d` |

### mint

| Токен | Hex |
|---|---|
| `mint1` | `#f9fefd` |
| `mint2` | `#effefa` |
| `mint3` | `#ddfbf3` |
| `mint4` | `#ccf7ec` |
| `mint5` | `#bbeee2` |
| `mint6` | `#a6e1d3` |
| `mint7` | `#87d0bf` |
| `mint8` | `#51bda7` |
| `mint9` | `#86ead4` |
| `mint10` | `#7fe1cc` |
| `mint11` | `#27756a` |
| `mint12` | `#16433c` |

### lime

| Токен | Hex |
|---|---|
| `lime1` | `#fcfdfa` |
| `lime2` | `#f7fcf0` |
| `lime3` | `#edfada` |
| `lime4` | `#e2f5c4` |
| `lime5` | `#d5edaf` |
| `lime6` | `#c6de99` |
| `lime7` | `#b2ca7f` |
| `lime8` | `#9ab654` |
| `lime9` | `#bdee63` |
| `lime10` | `#b0e64c` |
| `lime11` | `#59682c` |
| `lime12` | `#37401c` |

### yellow

| Токен | Hex |
|---|---|
| `yellow1` | `#fdfdf9` |
| `yellow2` | `#fffbe0` |
| `yellow3` | `#fff8c6` |
| `yellow4` | `#fcf3af` |
| `yellow5` | `#f7ea9b` |
| `yellow6` | `#ecdd85` |
| `yellow7` | `#dac56e` |
| `yellow8` | `#ffe366` |
| `yellow9` | `#fbe32d` |
| `yellow10` | `#f9da10` |
| `yellow11` | `#775f28` |
| `yellow12` | `#473b1f` |

### amber

| Токен | Hex |
|---|---|
| `amber1` | `#fefdfb` |
| `amber2` | `#fff9ed` |
| `amber3` | `#fff3d0` |
| `amber4` | `#ffecb7` |
| `amber5` | `#ffe0a1` |
| `amber6` | `#f5d08c` |
| `amber7` | `#e4bb78` |
| `amber8` | `#d6a35c` |
| `amber9` | `#ffc53d` |
| `amber10` | `#ffba1a` |
| `amber11` | `#915930` |
| `amber12` | `#4f3422` |

### orange

| Токен | Hex |
|---|---|
| `orange1` | `#fefcfb` |
| `orange2` | `#fff8f4` |
| `orange3` | `#ffedd5` |
| `orange4` | `#ffe0bb` |
| `orange5` | `#ffd3a4` |
| `orange6` | `#ffc291` |
| `orange7` | `#ffaa7d` |
| `orange8` | `#ed8a5c` |
| `orange9` | `#f76808` |
| `orange10` | `#ed5f00` |
| `orange11` | `#99543a` |
| `orange12` | `#582d1d` |

_Сгенерировано 2026-10-19 из бандла приложения; 23 семьи × 12 = 276 токенов.
Правки карты выполняются парой: этот файл + генерируемый \`src/palette-data.js\` (транслятор чтения)._