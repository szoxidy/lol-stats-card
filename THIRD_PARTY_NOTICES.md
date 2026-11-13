# 设计与资源来源

英雄原画来自 Riot Data Dragon，来源记录在 assets/art/sources.json。游戏内容及关联权利归 Riot Games/腾讯等权利方所有。

英雄图标来自 Riot Data Dragon。段位图像来自 CommunityDragon 提供的 Riot 游戏素材：https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/ 。本地文件的来源与哈希保存在 assets/icons/sources.json；段位素材按透明区域裁边，英雄图标与段位素材转为 WebP，用于 SVG 内嵌。

翡翠徽章来自 LeagueAkari 仓库随附的 Riot 游戏图像：`src/renderer-shared/assets/ranked-icons-large/emerald.png`，Git blob `a2e6505bafc4db77e403f6ee77b913796694410f`。这次只使用该游戏图像，没有复制其应用代码；来源和处理后哈希记录在 `assets/icons/sources.json`。仓库地址：https://github.com/LeagueAkari/LeagueAkari 。

演示头像为 Riot Data Dragon 的29号公开素材，来源见 `assets/demo/source.json`，不使用用户本地头像或截图。`examples/`由独立脚本构造演示资料生成，不对应真实账号。

本项目的MIT许可覆盖原创代码，不将游戏图像、上游商标或第三方字体重新授权为MIT。

Comfortaa 字体子集来自 Google Fonts，按 SIL Open Font License 1.1 使用；完整许可位于 assets/fonts/OFL.txt，来源在 assets/fonts/source.json。

卡片的紧凑结构、配色及信息层级参考 solstice23/osu-stats-signature，按英雄联盟数据重新实现。

## osu-stats-signature (MIT)

```text
MIT License

Copyright (c) 2021 solstice23

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

```
