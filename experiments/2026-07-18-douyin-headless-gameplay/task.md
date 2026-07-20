# 实验任务

在不启动 LayaAir IDE、抖音开发者工具或浏览器的条件下，直接执行生成器产出的 `Main.ts`，用可控输入和时钟验证 arcade、platformer、puzzle、shooter、strategy 五类玩法的核心状态变化与终态遥测。

验收条件：五类玩法各有至少一条确定性路径；断言来自 `GameGlobal.__GAMEFORGE_TEST__`；测试宿主不得网络访问、读写项目或冒充平台 API。
