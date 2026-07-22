# 入台旅游预约空位监控

每 15 分钟用 Playwright 打开以下公开预约页面，检查日历中是否出现可点击日期：

<https://tecomel-traveltotaiwan.youcanbook.me/>

发现空位后通过 [ntfy](https://ntfy.sh/) 发送手机推送。本程序只读取公开日历，不填写资料，也不会自动提交预约。

## 通知逻辑

- 从无空位变为有空位：立即通知。
- 可预约日期发生变化：立即通知。
- 空位持续不变：6 小时后再次提醒。
- 其余每 15 分钟检查不会重复通知。

GitHub Actions 会将状态保存为保留 2 天的私有 workflow artifact。artifact 不会出现在公开仓库的代码中；新的运行会读取最近一次状态。

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

## 4. 启用并测试

1. 打开仓库的 **Actions** 页面。
2. 选择 **Monitor booking availability**。
3. 点击 **Run workflow** 手动运行一次。
4. 打开运行日志，正常无空位时会看到：

   ```json
   {
     "available": false,
     "notification": "no-availability"
   }
   ```

定时运行配置在 [`.github/workflows/monitor.yml`](.github/workflows/monitor.yml)。当前时间为每小时第 7、22、37、52 分钟，即每 15 分钟检查一次。

> GitHub 可能延迟定时任务。公开仓库连续 60 天没有活动时，GitHub 也可能自动停用 schedule；届时进入 Actions 页面重新启用即可。

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
| `HEADLESS` | `true` | 是否无界面运行浏览器 |
| `DRY_RUN` | `false` | 是否禁止真正发送通知 |

## 修改检查频率

GitHub Actions 使用 cron。当前为每 15 分钟：

```yaml
- cron: "7,22,37,52 * * * *"
```

如需每 10 分钟，可改为：

```yaml
- cron: "7,17,27,37,47,57 * * * *"
```

不建议设置得更频繁，以免给公开预约服务造成不必要的负担。

