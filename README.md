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

- **智能用药提醒**：根据药单自动生成每日用药计划，在服药时间前推送通知。
- **一键打勾确认**：每次服药后可勾选确认，清晰记录当天用药情况。
- **药品数量追踪**：记录药品剩余数量，提前一周在库存不足时自动提醒补充。
- **AI 药单解析**：支持调用 OpenAI GPT 等大语言模型，用自然语言描述药单，自动解析生成用药计划（需配置 API Key）。
- **用药历史记录**：可按日期查看每日用药记录。
- **多用户支持**：支持添加多个用户，角色分为「患者本人」和「家庭成员」：
  - **患者**：接收服药提醒推送。
  - **家庭成员**：可查看患者用药情况，关爱家人健康。
- **家庭共享**：通过家庭代码关联家庭成员账户，方便家人协同管理。
- **离线可用**：基于 Service Worker 缓存，断网后仍可正常使用。

### 技术栈

| 技术 | 说明 |
|------|------|
| HTML / CSS / JavaScript | 纯前端实现，无需构建工具 |
| PWA (Service Worker + Web App Manifest) | 支持离线使用和桌面安装 |
| IndexedDB | 本地数据持久化存储 |
| Web Notifications API | 系统级推送提醒 |
| OpenAI API（可选）| AI 自然语言药单解析 |

### Docker 部署

```bash
# 构建镜像
docker build -t medication-reminder .

# 运行容器（映射到宿主机 8080 端口）
docker run -d -p 8080:80 --name medication-reminder medication-reminder
```

运行后，在浏览器中打开 `http://localhost:8080` 即可访问应用。

### 快速开始

1. 使用浏览器打开应用页面（或将仓库部署至静态托管服务，如 GitHub Pages）。
2. 首次打开时，输入姓名并选择角色（患者 / 家庭成员）。
3. 前往「药品」选项卡，点击 **＋** 添加药品，手动填写或使用 AI 解析药单。
4. 返回「今日」选项卡，按时服药后打勾确认。
5. 在「设置」中开启通知权限，以接收自动推送提醒。

### 安装为桌面应用（PWA）

- **iOS（Safari）**：点击分享按钮 → 添加到主屏幕。
- **Android（Chrome）**：点击菜单 → 添加到主屏幕。
- **桌面（Chrome / Edge）**：点击地址栏右侧的安装图标。

### 文件结构

```
MedicationReminder-/
├── index.html          # 应用主页面
├── manifest.json       # PWA 配置文件
├── sw.js               # Service Worker（离线缓存）
├── css/
│   └── style.css       # 样式文件
├── js/
│   ├── db.js           # IndexedDB 数据层
│   ├── ai.js           # AI 药单解析模块
│   └── app.js          # 应用主逻辑
└── icons/              # 应用图标
```

---

## English Documentation

### Overview

**MedicationReminder** is a Progressive Web App (PWA) built for mobile that helps users manage medication schedules and stay on track with their health. It requires no installation — just open it in a browser and optionally add it to the home screen.

### Features

- **Smart Medication Reminders**: Automatically generates a daily medication schedule from your prescription and sends push notifications before each dose.
- **One-tap Dose Confirmation**: Check off each dose after taking it to keep a clear record of your daily medication.
- **Inventory Tracking**: Tracks remaining medication quantities and sends a low-stock alert one week before running out.
- **AI Prescription Parsing**: Integrates with OpenAI GPT (and compatible APIs) to parse natural-language prescription descriptions and auto-fill medication details (requires API key configuration).
- **Medication History**: Browse past medication records by date.
- **Multi-user Support**: Add multiple users with two roles:
  - **Patient**: Receives medication reminder notifications.
  - **Family Member**: Can view the patient's medication status to help monitor their health.
- **Family Sharing**: Link family members' accounts using a shared family code for coordinated management.
- **Offline-ready**: Service Worker caching ensures the app works without an internet connection.

### Tech Stack

| Technology | Description |
|-----------|-------------|
| HTML / CSS / JavaScript | Pure frontend, no build tools required |
| PWA (Service Worker + Web App Manifest) | Offline support and home screen installation |
| IndexedDB | Client-side persistent data storage |
| Web Notifications API | System-level push reminders |
| OpenAI API (optional) | AI-powered natural-language prescription parsing |

### Docker Deployment

```bash
# Build the image
docker build -t medication-reminder .

# Run the container (exposed on host port 8080)
docker run -d -p 8080:80 --name medication-reminder medication-reminder
```

Then open `http://localhost:8080` in your browser to access the app.

### Getting Started

1. Open the app URL in a browser (or deploy the repository to a static host such as GitHub Pages).
2. On first launch, enter your name and choose a role (Patient or Family Member).
3. Go to the **Medications** tab and tap **＋** to add medications — fill in the form manually or use AI parsing.
4. Return to the **Today** tab and check off each dose after taking it.
5. Enable notification permissions in **Settings** to receive automatic push reminders.

### Install as a Desktop / Mobile App (PWA)

- **iOS (Safari)**: Tap the Share button → Add to Home Screen.
- **Android (Chrome)**: Tap the menu → Add to Home Screen.
- **Desktop (Chrome / Edge)**: Click the install icon in the address bar.

### Project Structure

```
MedicationReminder-/
├── index.html          # Main application page
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker (offline cache)
├── css/
│   └── style.css       # Stylesheet
├── js/
│   ├── db.js           # IndexedDB data layer
│   ├── ai.js           # AI prescription parsing module
│   └── app.js          # Main application logic
└── icons/              # Application icons
```

### License

This project is open source. Feel free to use, modify, and distribute it.

