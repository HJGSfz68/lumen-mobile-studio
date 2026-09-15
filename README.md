# LUMEN · MOBILE STUDIO

把任意网站装进手机：输入网址，在线生成可安装、可分享的独立 Android APK。

## 功能

- **应用信息配置**：应用名称、网站地址、唯一包名、版本名/版本号
- **图标与体验**：自定义启动图标（512×512 建议）、网页深色适配、全屏浏览、外链交系统浏览器
- **真实 APK 生成**：服务端调用 Android 构建链（aapt2 / javac / d8 / zipalign / apksigner）编译 WebView 壳工程，输出已签名、可直接安装的成品 APK
- **安装与分享**：页面内一键下载 APK，系统分享下载链接

## 项目结构

```
app/                  前端界面（纯静态 HTML/CSS/JS，深色科技风）
server/
  server.py           HTTP 服务：静态页托管 + /api/generate-apk 构建接口 + APK 下载
  build_apk.sh        APK 构建脚本（aapt2 编译链接 → javac → d8 → zipalign → apksigner 签名）
  template/
    AndroidManifest.xml       WebView 壳清单（占位符由构建脚本填充）
    java/.../MainActivity.java WebView 主界面（加载目标网址，支持深色/全屏/外链配置）
    res/                      主题与默认图标
```

## 工作原理

1. 浏览器提交配置（名称、网址、包名、版本、图标、体验开关）到 `/api/generate-apk`
2. 服务端将配置注入 WebView 壳工程模板
3. 调用 Android SDK 工具链编译、打包并对齐签名
4. 返回 APK 下载地址，APK 保留在 `server/output/`

生成的 APK 本质是一个原生 Android WebView 应用：启动后全屏加载目标网站，保留返回键网页回退等原生体验。

## 部署

### 依赖

- Linux + JDK 17（`openjdk-17-jdk-headless`）
- Android SDK：`build-tools;34.0.0`、`platforms;android-34`
- `zip`、`python3`

```bash
# 安装 Android 命令行工具与组件
mkdir -p /opt/android-sdk/cmdline-tools
curl -sSL -o /tmp/ct.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip /tmp/ct.zip -d /opt/android-sdk/cmdline-tools
mv /opt/android-sdk/cmdline-tools/cmdline-tools /opt/android-sdk/cmdline-tools/latest
yes | /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager --sdk_root=/opt/android-sdk --licenses
/opt/android-sdk/cmdline-tools/latest/bin/sdkmanager --sdk_root=/opt/android-sdk \
  "platform-tools" "build-tools;34.0.0" "platforms;android-34"
```

### 启动

```bash
# 按实际路径修改 server.py 顶部的 BUILD_SH、OUT_DIR、STATIC_DIR
PORT=8080 python3 server/server.py
```

访问 `http://<host>:8080` 即可使用。建议用 systemd 托管（参考 Unit：`ExecStart=/usr/bin/python3 /opt/lumen/server.py`，环境变量 `PORT=8080`）。

### 内存要求

构建过程峰值约 400MB~500MB，建议服务器至少 1GB 内存并配置 swap。

## 注意事项

- 首次构建会自动生成签名密钥 `server/.keystore`（密码见 `build_apk.sh`），请妥善保管以保证后续升级安装同包名 APK 时签名一致
- `server/output/` 中的 APK 与 `.idsig` 为构建产物，密钥与产物均已加入 `.gitignore`
- 目标网站需支持 HTTP/HTTPS 公开访问；壳应用已开启 `usesCleartextTraffic` 以兼容 http 站点
