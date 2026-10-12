| 名称 | 分类 | 对2.5D肉鸽搜打撤的作用 | 获取/安装（Mint Linux） |
|------|------|------------------------|--------------------------|
| scenario-game-assets | 2D美术-批量出图 | 角色/敌人/道具/tileset/透明底批量生产 | `npx skills add scenario-labs/skills --skill scenario-game-assets` |
| scenario-sprite-animation | 2D美术-序列帧 | 行走/待机/攻击/VFX帧序列与切片 | `npx skills add scenario-labs/skills --skill scenario-sprite-animation` |
| scenario-textures | 2D美术-材质 | 无缝地面/墙面/金属/血污 | `npx skills add scenario-labs/skills --skill scenario-textures` |
| scenario-consistency | 2D美术-风格统一 | 同一角色跨批次保持画风一致 | `npx skills add scenario-labs/skills --skill scenario-consistency` |
| scenario-quality-gate | 美术-验收质检 | 出图打分、brief比对、废图剔除 | `npx skills add scenario-labs/skills --skill scenario-quality-gate` |
| sprite-sheet | 2D美术-图集 | walk/attack/idle/death网格帧+Phaser配置 | `npx skills add https://github.com/SummerEngine/summer --skill sprite-sheet` |
| pixel-art-sprites | 2D美术-像素 | 限色精灵、调色板、像素2.5D | `npx skills add https://github.com/SummerEngine/summer --skill pixel-art-sprites` |
| character-portrait | 2D美术-立绘 | 干员/遗物持有者立绘与头像 | `npx skills add https://github.com/SummerEngine/summer --skill character-portrait` |
| tileable-texture | 2D美术-地形 | 墙/地/天花板无缝材质 | `npx skills add https://github.com/SummerEngine/summer --skill tileable-texture` |
| sprite-animator | 2D美术-动画 | 出walk/run/jump/attack再拼sheet | `npx skills add toymoil/skills --skill sprite-animator` |
| vfx-prompt | 特效-提示词 | 预警圈/命中/冲击/flipbook | `npx skills add toymoil/compile-prompt-vfx --skill vfx-prompt` |
| icon-ui-prompt | UI-图标 | 技能图标/遗物/HUD/卡牌框 | `npx skills add toymoil/compile-prompt-icon-ui --skill icon-ui-prompt` |
| material-prompt | 材质-提示词 | 可平铺、像素化不破缝 | `npx skills add toymoil/compile-prompt-material --skill material-prompt` |
| asset-lineage-planner | 美术-资产管理 | 杂兵→精英→Boss→掉落继承 | `npx skills add toymoil/skills --skill asset-lineage-planner` |
| asset-style-kit-router | 美术-风格路由 | Hades写实 vs 方舟扁平比例控制 | `npx skills add toymoil/skills --skill asset-style-kit-router` |
| score-readability-from-game-camera | 美术-可读性 | 按2.5D镜头评远处小怪清晰度 | `npx skills add toymoil/skills --skill score-readability-from-game-camera` |
| sprite-asset-pipeline | 工程-美术管线 | raw→aseprite→pack→Phaser加载→压缩 | `npx skills add code-brain/skills --skill sprite-asset-pipeline` |
| asset-strategy | 工程-需求路由 | 2D/3D/音频/VFX分诊派发 | `npx skills add https://github.com/SummerEngine/summer --skill asset-strategy` |
| act-combat-design | 战斗设计 | Hades式Boss招式/打击感基线（中文） | `npx skills add https://github.com/koisama0411/act-combat-design` |
| combat-feel | 战斗手感 | startup/active/recovery/hitstop帧数据 | `npx skills add https://github.com/omer-metin/combat-design` |
| roguelike-run | 肉鸽系统 | 种子/RNG/房间/掉落/难度/搜打撤 | 自建（参考 gamedev-skills/roguelike） |
| rogue-build | 构筑经济 | 遗物hook/synergy/能量/删除卡 | 自建（参考杀戮尖塔） |
| roster-nodes | 干员/节点 | 招募成本/进阶/节点事件/难度选项 | 自建（参考集成战略） |
| phaser4-arch | 工程架构 | Phaser4场景/物理/试跑/性能复查 | 摘 yakoub-ai/phaser4-gamedev 的arch部分 |
