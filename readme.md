# Primary School Mathematics AI

小学口算出题 MVP：基于原项目的 Vue 界面，使用可验证、可复现、有上限的数学题生成器，并通过 pi SDK 接入 Pinniq AI。

## 本地运行

```sh
npm install --include=dev --ignore-scripts
npm run test:mvp
npm run agent       # 另一个终端运行 npm run dev
```

打开 `http://127.0.0.1:1101`。

## AI 配置

默认 OpenAI 兼容地址为 `https://api.pinniq.org/v1`。前端输入从 Pinniq 后台生成的 API Key。Key 仅保存到当前浏览器 sessionStorage，服务端只在当前请求的内存中使用，不写日志、不落盘。

可通过环境变量指定默认模型：

```sh
PINNIQ_DEFAULT_MODEL=模型ID npm run agent
```

## MVP 可靠性改进

- 不再使用 `eval()` 计算题目
- 支持 seed，便于复现同一份试卷
- 试卷内题目去重
- 配置和除零等错误提前校验
- 生成尝试次数有上限，不满足条件时返回可读错误
- 每道题同时保留显示文本、答案、运算步骤、操作数和运算符
- 使用 Fisher-Yates 洗牌
- `tests/psm.test.mjs` 覆盖确定性、去重、不可能条件和除零

## 部署到 ks.teacherdeck.org

项目包含两个部署模板：

- `nginx-ks.teacherdeck.org.conf.example`
- `primary-school-math-ai.service.example`

推荐使用现有 Ubuntu/Nginx 服务器。先在域名 DNS 控制台添加：

```text
类型：A
主机记录：ks
记录值：49.51.200.107
TTL：默认
```

在本地构建：

```sh
npm install --include=dev --ignore-scripts
npm run test:mvp
npm run build
```

把项目上传到服务器 `/var/www/primary-school-math-ai`，然后在服务器执行：

```sh
cd /var/www/primary-school-math-ai
npm install --omit=dev --ignore-scripts
sudo cp primary-school-math-ai.service.example /etc/systemd/system/primary-school-math-ai.service
sudo systemctl daemon-reload
sudo systemctl enable --now primary-school-math-ai
sudo systemctl status primary-school-math-ai
```

注意：服务端依赖 `@earendil-works/pi-ai` 和 `@earendil-works/pi-coding-agent`，不能只上传 `dist`。

配置 Nginx：

```sh
sudo cp nginx-ks.teacherdeck.org.conf.example /etc/nginx/sites-available/ks.teacherdeck.org
sudo ln -s /etc/nginx/sites-available/ks.teacherdeck.org /etc/nginx/sites-enabled/ks.teacherdeck.org
sudo nginx -t
sudo systemctl reload nginx
```

确认 HTTP 可访问后申请 HTTPS：

```sh
sudo certbot --nginx -d ks.teacherdeck.org
```

检查：

```sh
curl https://ks.teacherdeck.org/healthz
sudo journalctl -u primary-school-math-ai -f
```

上线后建议在 systemd 配置中设置：

```text
ALLOWED_PROVIDER_HOSTS=api.pinniq.org
```

如果必须允许自定义中转站，填写逗号分隔的域名白名单，不要把任意 URL 直接暴露给公网用户。

## 许可证

原项目为 Apache-2.0。衍生版本保留原许可证和归属信息。
