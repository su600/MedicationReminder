# 💊 用药助手 — 智能药物提醒 / MedicationReminder

<p align="center">
  <strong>智能提醒 · 家人关爱 · 健康守护</strong><br>
  <em>Smart Reminders · Family Care · Health Guardian</em>
</p>

---

## 中文文档

### 简介

**用药助手**是一款基于 PWA（渐进式 Web 应用）架构的手机端药物提醒应用，无需安装即可添加至桌面使用。支持多用户管理，为患者和家庭成员提供智能用药提醒服务。

### 功能特性

- **智能用药提醒**：根据药单自动生成每日用药计划，在服药时间前推送通知；支持设置提前提醒时长，通知提供「15分钟后提醒」（Snooze）操作。
- **一键打勾确认**：每次服药后可勾选确认，清晰记录当天用药情况。
- **药品数量追踪**：记录药品剩余数量，提前一周在库存不足时自动提醒补充。
- **AI 药单解析**：支持多种 AI 服务商（GitHub Copilot、阿里云百炼 DeepSeek、自定义 OpenAI 兼容接口），用自然语言描述药单，自动解析生成用药计划（需配置 API Key）。无 API Key 时自动回退到内置规则解析。
- **AI 用药咨询**：开启 AI 功能后，屏幕右下角显示悬浮聊天按钮，可随时向 AI 提问用药相关问题，支持多轮对话。
- **用药历史记录**：可按日期查看每日用药记录及服药合规率统计。
- **多用户支持**：支持添加多个用户，角色分为「患者本人」和「家庭成员」：
  - **患者**：接收服药提醒推送。
  - **家庭成员**：可查看患者用药情况，关爱家人健康。
- **家庭共享**：通过家庭代码关联家庭成员账户，方便家人协同管理。API Key 保存在本设备/浏览器中，同设备所有用户共享，不随家庭代码跨设备同步。
- **离线可用**：基于 Service Worker 缓存，断网后仍可正常使用。

### AI 功能配置

在「设置」→「AI 智能功能」中开启 AI 开关，然后点击「API 配置」，支持以下服务商：

| 服务商 | 默认模型 | 说明 |
|--------|----------|------|
| GitHub Copilot（默认）| gemini-3-flash | 使用 GitHub Models API，需要 GitHub PAT |
| 阿里云百炼 – DeepSeek | deepseek-v3.2 | 需要阿里云 API Key |
| 自定义 OpenAI 兼容接口 | 用户自定义 | 填写 Base URL 和模型名称 |

未配置 API Key 时，AI 药单解析将自动回退到内置中文规则解析器。

### 技术栈

| 技术 | 说明 |
|------|------|
| HTML / CSS / JavaScript | 纯前端实现，无需构建工具 |
| PWA (Service Worker + Web App Manifest) | 支持离线使用和桌面安装 |
| IndexedDB | 本地数据持久化存储 |
| Web Notifications API | 系统级推送提醒（含稍后提醒 Snooze） |
| OpenAI 兼容 API（可选）| AI 自然语言药单解析 & 用药咨询 |

### Docker 部署

```bash
# 构建镜像
docker build -t medication-reminder .

# 运行容器（映射到宿主机 8080 端口）
docker run -d -p 8080:8080 --name medication-reminder medication-reminder
```

运行后，在浏览器中打开 `http://localhost:8080` 即可访问应用。

### 快速开始

1. 使用浏览器打开应用页面（或将仓库部署至静态托管服务，如 GitHub Pages）。
2. 首次打开时，输入姓名并选择角色（患者 / 家庭成员）。如为家庭成员，可选择创建新家庭或输入家庭代码加入已有家庭。
3. 前往「药品」选项卡，点击 **＋** 添加药品，手动填写或使用 AI 解析药单。
4. 返回「今日」选项卡，按时服药后打勾确认。
5. 在「设置」中开启通知权限，以接收自动推送提醒；可配置提前提醒时长。
6. （可选）在「设置」→「AI 智能功能」中开启 AI，配置 API Key 后即可使用 AI 药单解析和用药咨询。

### 安装为桌面应用（PWA）

- **iOS（Safari）**：点击分享按钮 → 添加到主屏幕。
- **Android（Chrome）**：点击菜单 → 添加到主屏幕。
- **桌面（Chrome / Edge）**：点击地址栏右侧的安装图标。

### 构建 Android 安装包（Cordova）

项目已支持通过 Cordova 将当前 Web 代码封装为 Android App（APK）：

```bash
npm install
npm run android:init
npm run android:build:debug
```

构建完成后，可在 `android-build/platforms/android/app/build/outputs/apk/debug/` 下找到调试安装包。
当前 Android 封装配置最低支持 Android 7.0（API 24）。
Android 封装默认仅允许 HTTPS 网络访问（`config.xml`），用于支持可配置的 AI / 家庭同步服务地址。
`npm run android:init` 使用了 `rm/cp` 命令，需在 Linux/macOS 或 Windows + WSL 环境执行。

### 文件结构

```
MedicationReminder/
├── index.html          # 应用主页面
├── manifest.json       # PWA 配置文件
├── sw.js               # Service Worker（离线缓存）
├── Dockerfile          # Docker 部署配置
├── css/
│   └── style.css       # 样式文件
├── js/
│   ├── db.js           # IndexedDB 数据层
│   ├── ai.js           # AI 药单解析 & 咨询模块
│   └── app.js          # 应用主逻辑
└── icons/              # 应用图标
```

---

## English Documentation

### Overview

**MedicationReminder** is a Progressive Web App (PWA) built for mobile that helps users manage medication schedules and stay on track with their health. It requires no installation — just open it in a browser and optionally add it to the home screen.

### Features

- **Smart Medication Reminders**: Automatically generates a daily medication schedule from your prescription and sends push notifications before each dose. Supports configurable advance reminder time; notifications include a "Snooze 15 min" action button.
- **One-tap Dose Confirmation**: Check off each dose after taking it to keep a clear record of your daily medication.
- **Inventory Tracking**: Tracks remaining medication quantities and sends a low-stock alert one week before running out.
- **AI Prescription Parsing**: Supports multiple AI providers (GitHub Copilot, Aliyun Bailian DeepSeek, or any custom OpenAI-compatible endpoint) to parse natural-language prescription descriptions and auto-fill medication details (requires API key configuration). Falls back to a built-in rule-based parser when no API key is present.
- **AI Medication Chat**: When AI is enabled, a floating chat button appears in the bottom-right corner for multi-turn medication consultation with the AI assistant.
- **Medication History**: Browse past medication records by date with compliance statistics.
- **Multi-user Support**: Add multiple users with two roles:
  - **Patient**: Receives medication reminder notifications.
  - **Family Member**: Can view the patient's medication status to help monitor their health.
- **Family Sharing**: Link family members' accounts using a shared family code for coordinated management. The API key is stored locally in the browser on each device; it is shared among all users on the same device but is not synced across devices via the family code.
- **Offline-ready**: Service Worker caching ensures the app works without an internet connection.

### AI Configuration

Enable AI in **Settings (设置) → AI 智能功能**, then tap **API 配置** to select a provider:

| Provider | Default Model | Notes |
|----------|--------------|-------|
| GitHub Copilot (default) | gemini-3-flash | Uses GitHub Models API; requires a GitHub PAT |
| Aliyun Bailian – DeepSeek | deepseek-v3.2 | Requires an Aliyun API key |
| Custom OpenAI-compatible | User-defined | Enter your own Base URL and model name |

Without an API key, AI prescription parsing automatically falls back to the built-in Chinese rule-based parser.

### Tech Stack

| Technology | Description |
|-----------|-------------|
| HTML / CSS / JavaScript | Pure frontend, no build tools required |
| PWA (Service Worker + Web App Manifest) | Offline support and home screen installation |
| IndexedDB | Client-side persistent data storage |
| Web Notifications API | System-level push reminders with Snooze support |
| OpenAI-compatible API (optional) | AI-powered prescription parsing & medication chat |

### Docker Deployment

```bash
# Build the image
docker build -t medication-reminder .

# Run the container (exposed on host port 8080)
docker run -d -p 8080:8080 --name medication-reminder medication-reminder
```

Then open `http://localhost:8080` in your browser to access the app.

### Getting Started

1. Open the app URL in a browser (or deploy the repository to a static host such as GitHub Pages).
2. On first launch, enter your name and choose a role (Patient or Family Member). Family members can create a new family or join an existing one with a family code.
3. Go to the **Medications** tab and tap **＋** to add medications — fill in the form manually or use AI parsing.
4. Return to the **Today** tab and check off each dose after taking it.
5. Enable notification permissions in **Settings** to receive automatic push reminders; configure the advance reminder time as needed.
6. (Optional) Enable AI in **Settings (设置) → AI 智能功能** and configure an API key to use AI prescription parsing and the medication chat assistant.

### Install as a Desktop / Mobile App (PWA)

- **iOS (Safari)**: Tap the Share button → Add to Home Screen.
- **Android (Chrome)**: Tap the menu → Add to Home Screen.
- **Desktop (Chrome / Edge)**: Click the install icon in the address bar.

### Build Android App Package (Cordova)

The project now supports packaging the existing web app into an Android APK with Cordova:

```bash
npm install
npm run android:init
npm run android:build:debug
```

After building, the debug APK is generated under
`android-build/platforms/android/app/build/outputs/apk/debug/`.
The current Android wrapper configuration requires Android 7.0+ (API 24).
The Android wrapper allows HTTPS-only network access by default (`config.xml`) so configurable AI/family sync endpoints can be used.
`npm run android:init` uses `rm/cp`, so run it on Linux/macOS or Windows with WSL.

### Project Structure

```
MedicationReminder/
├── index.html          # Main application page
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker (offline cache)
├── Dockerfile          # Docker deployment configuration
├── css/
│   └── style.css       # Stylesheet
├── js/
│   ├── db.js           # IndexedDB data layer
│   ├── ai.js           # AI prescription parsing & chat module
│   └── app.js          # Main application logic
└── icons/              # Application icons
```

### License

This project is open source. Feel free to use, modify, and distribute it.
