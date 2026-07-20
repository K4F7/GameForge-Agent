# GameVerifier 浏览器运行时诊断与恢复

定位系统 Chrome verifier 在 30/120 秒启动超时的问题。对 Node 与 Bun 直接承载 Playwright 做有界对照；修复不可取消的启动失败、浏览器清理、Chrome 路径预检和错误分类；提供独立 browser doctor，并用此前生成的 lazy-loader 项目重跑真实 verifier。

不得读取或终止用户 Chrome profile/会话，不把应用内浏览器 smoke 替代系统 Chrome verifier。
