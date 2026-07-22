# 入台旅游预约空位监控

由 cron-job.org 每 15 分钟触发 GitHub Actions，再用 Playwright 打开以下公开预约页面，检查日历中是否出现可点击日期：

<https://tecomel-traveltotaiwan.youcanbook.me/>

发现空位后通过 [ntfy](https://ntfy.sh/) 发送手机推送。本程序只访问公开预约流程，不填写资料，也不会自动提交预约。

当前版本还会在新空位出现时自动探索预约流程：选择最早可用日期和最早可用时段，进入资料表单后停止。它不会填写个人资料，也不会点击最终提交按钮。第一次成功捕获真实表单后，才能根据实际字段安全地实现自动填写和提交。

## 通知逻辑

- 从无空位变为有空位：立即通知。
- 可预约日期发生变化：立即通知。
- 空位持续不变：6 小时后再次提醒。
- 其余每 15 分钟检查不会重复通知。

GitHub Actions 会将状态保存为保留 2 天的 workflow artifact。artifact 不会提交到仓库代码中；新的运行会读取最近一次状态。由于这是公开仓库，不要把个人资料或密钥写入状态文件。

## 空位分析 artifact

当空位首次出现，或可用日期集合发生变化时，监控会创建一个保留 14 天的 `availability-discovery-*` artifact。为避免频繁操作预约页面，空位持续不变时不会重复深度采集。

采集流程：

1. 保存可用日期日历。
2. 点击最早可用日期，保存可选时段页面。
3. 点击最早可用时段，保存资料表单页面。
4. 在填写任何资料和最终提交之前停止。

Artifact 包含：

- 每一步的完整页面截图。
- 清理后的 HTML：移除表单值、勾选状态、内联脚本内容和疑似 token 属性；URL 仅保留路径及参数名称，不保留参数值。
- 结构化表单信息：字段名称、标签、类型、placeholder、必填状态及稳定选择器。
- 脱敏网络日志：只保存预约网站同源请求的方法、状态码、路径和 query 参数名称；不保存参数值、请求体或 Header。
- `manifest.json`：实际选择的日期、时段、完成阶段及采集错误。

查看方法：打开对应 GitHub Actions 运行，在页面底部 **Artifacts** 区域下载 `availability-discovery-运行ID`。公开仓库的 artifact 不应视作私密存储；代码已经尽量脱敏，但仍不要把个人资料填入当前采集流程，也不要公开转发下载内容。

## 1. 创建 ntfy topic

1. 在手机安装 ntfy，或打开 <https://ntfy.sh/app>。
2. 生成一个难以猜测的随机 topic，例如：

   ```bash
   openssl rand -hex 24
   ```

3. 在 ntfy 中订阅这个 topic。
4. 不要把 topic 写进代码或提交到仓库。

ntfy.sh 的普通 topic 默认是公开的，知道 topic 名称的人可以接收或发送消息，因此随机字符串应足够长。需要更严格的隐私时，可以在 ntfy 注册账号并保留 topic，或使用自建 ntfy 服务。

## 2. 创建公开 GitHub 仓库

在 GitHub 创建一个 **Public** 仓库，然后在本目录执行：

```bash
git init
git add .
git commit -m "Add booking availability monitor"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/YOUR_REPOSITORY.git
git push -u origin main
```

公开仓库会公开源代码和预约网址，但不会公开 GitHub Secrets。

## 3. 配置 GitHub Secret

进入仓库：

`Settings → Secrets and variables → Actions → New repository secret`

添加：

- Name：`NTFY_TOPIC`
- Secret：第 1 步生成的随机 topic

如果使用自建 ntfy，再在同一页面的 **Variables** 中增加 `NTFY_BASE_URL`；使用 ntfy.sh 时无需设置。

## 4. 手动测试

1. 打开仓库的 **Actions** 页面。
2. 选择 **Monitor booking availability**。
3. 点击 **Run workflow**。
4. 不勾选 `Send an ntfy test notification...` 时，会立即检查预约页面。
5. 勾选该选项时，只发送一条 ntfy 测试通知，不运行 Playwright。
6. 打开检查任务日志，正常无空位时会看到：

   ```json
   {
     "available": false,
     "notification": "no-availability"
   }
   ```

## 5. 创建 GitHub Fine-grained token

cron-job.org 需要调用 GitHub 的 workflow-dispatch API。为它创建一个权限受限的 token：

1. 打开 GitHub：`Settings → Developer settings → Personal access tokens → Fine-grained tokens`。
2. 点击 **Generate new token**。
3. 设置一个较短的过期时间，例如 90 天，并在到期前更换。
4. Repository access 选择 **Only select repositories**，只选择 `ycb`。
5. Repository permissions 中只把 **Actions** 设置为 **Read and write**。
6. 生成并立即复制 token；GitHub 之后不会再次显示它。

不要把 token 放进仓库、README、issue 或 Actions 日志。cron-job.org 会持有它，因此不要使用权限更大的 classic PAT。

## 6. 配置 cron-job.org

在 <https://console.cron-job.org/> 创建一个 cronjob：

- Title：`Taiwan booking availability monitor`
- URL：

  ```text
  https://api.github.com/repos/danielzhang5566/ycb/actions/workflows/monitor.yml/dispatches
  ```

- Schedule：每 15 分钟
- Request method：`POST`
- Request headers：

  ```text
  Accept: application/vnd.github+json
  Authorization: Bearer YOUR_FINE_GRAINED_TOKEN
  Content-Type: application/json
  X-GitHub-Api-Version: 2026-03-10
  ```

- Request body：

  ```json
  {
    "ref": "main",
    "inputs": {
      "send_test_notification": "false"
    }
  }
  ```

保存后先使用 cron-job.org 的 **Test run**。成功时 GitHub API 返回 HTTP `204 No Content`；几秒后可以在仓库 **Actions** 页面看到一条名为 **Check booking availability** 的运行记录。

cron-job.org 官方说明服务完全免费，单个任务最高可以每分钟执行一次，但仍应遵守 fair use。本项目每 15 分钟一次即可。

## 本地运行

需要 Node.js 20 或以上版本：

```bash
npm ci
npx playwright install chromium
NTFY_TOPIC="your-random-topic" npm run check
```

只验证检测逻辑而不发送通知：

```bash
DRY_RUN=true npm run check
```

显示浏览器窗口调试：

```bash
HEADLESS=false DRY_RUN=true npm run check
```

运行单元测试：

```bash
npm test
```

## 配置项

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `BOOKING_URL` | 当前驻墨尔本办事处页面 | 需要监控的页面 |
| `NTFY_TOPIC` | 无 | ntfy topic；发现空位时必须配置 |
| `NTFY_BASE_URL` | `https://ntfy.sh` | ntfy 服务地址 |
| `NOTIFY_REMINDER_HOURS` | `6` | 空位不变时再次提醒的间隔 |
| `STATE_FILE` | `.state/availability.json` | 去重状态文件 |
| `CAPTURE_DISCOVERY` | `true` | 新空位出现时是否探索日期、时段和表单 |
| `DISCOVERY_ARTIFACT_DIR` | `.artifacts/discovery` | 页面分析资料输出目录 |
| `HEADLESS` | `true` | 是否无界面运行浏览器 |
| `DRY_RUN` | `false` | 是否禁止真正发送通知 |

## 自动提交路线

当前代码故意不实现最终提交。原因是尚未看到真实表单，猜测字段、验证方式或提交按钮可能造成错误预约，也可能把姓名等个人资料写进公开仓库或日志。

拿到第一次 `availability-discovery-*` artifact 后，下一阶段将：

1. 根据 `03-form.structure.json` 映射姓名、邮箱、电话等字段。
2. 仅通过 GitHub Actions Secrets 注入个人资料，不写入仓库或 artifact。
3. 加入目标日期、时段和时区偏好，避免预约到不合适时间。
4. 检测 CAPTCHA、条款确认和服务端验证；需要人工处理时立即通知而不是绕过。
5. 在最终提交前加入幂等保护，避免并发或重试造成重复预约。
6. 提交成功后保存不含个人资料的确认摘要并停止后续任务。

## 修改检查频率

检查频率在 cron-job.org 控制，无需修改仓库代码。建议保持每 15 分钟；不建议设置得更频繁，以免给公开预约服务造成不必要的负担。
