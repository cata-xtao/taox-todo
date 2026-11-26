# 项目简报

## 我是谁
产品经理，不写代码。你用自然语言为我生成代码，我负责验收和反馈。

## 项目信息
- 项目名：ob-todo-plugin
- 插件名：taox todo
- 作者：cata
- 目标：将旧版插件重构为 TypeScript 模块化源码，并重命名为 taox todo。

## 技术规范与工具
- TypeScript + esbuild。禁止纯 JS。
- 你已经安装了全局 AI Skill (`obsidian-plugin-skill`)，请严格遵守其中的规范（如内存回收机制、代码质量）。
- 必须严格模块化，不允许把所有逻辑堆在 main.ts，main.ts 只负责编排。

## 硬性验收标准（每轮必须满足）
1. `npm run build` 成功，产出 Obsidian 可加载的 main.js。
2. Obsidian 中启用插件无报错。
3. 无 TypeScript 类型错误。
4. 新逻辑落在 src/ 下的对应模块文件中。

## 工作方式
- 每轮只做我指定的一个任务，完成后停下来等我验收。
- 不直接抄袭旧版代码，而是用 TS 重构。