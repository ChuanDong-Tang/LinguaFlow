# Web 静态站点部署

官网与管理后台和 App、API 共用同一个 Git 仓库。云端只保留一个仓库工作副本，
避免分别维护 `oio` 与 `oio-admin` 两份源码。

以下以仓库位于 `/www/LinguaFlow` 为例：

```text
/www/LinguaFlow/apps/website   官网 Nginx root
/www/LinguaFlow/apps/admin     管理后台 Nginx root
```

首次部署时，在 `/www` 下克隆私有仓库，并将 Nginx 的两个站点根目录分别指向
以上目录。以后更新只需在仓库根目录执行：

```bash
cd /www/LinguaFlow
git pull --ff-only
```

当前官网和管理后台都是静态文件，不需要安装依赖或执行构建，拉取完成后即可
由 Nginx 提供最新文件。Nginx 配置没有改变时也不需要 reload。

如果暂时不方便修改现有 Nginx root，可以让原来的 `/www/oio` 和
`/www/oio-admin` 指向仓库内对应目录的符号链接。切换前应先备份并核对现有
目录，不能直接覆盖正在使用的目录。

## 发布约束

- 只在本地仓库修改官网和管理后台，然后提交、推送，再由云端拉取。
- 云端工作副本不直接编辑，`git status --short` 应保持为空。
- 更新前先运行 `git status --short`；如果云端存在未提交修改，停止拉取并先
  查明来源，避免覆盖线上临时改动。
- 使用 `git pull --ff-only`，不在生产机器上自动创建合并提交。
- APK 不放进 Git；官网只引用下载域名或对象存储上的带版本文件。
- `.env`、证书、Nginx 配置和其他生产机密不放入站点源码目录。

未来官网账号系统如果引入前端构建，再将更新步骤统一封装为部署脚本，例如
“拉取、安装锁定依赖、构建、原子切换产物”。在此之前保持静态直出即可。
