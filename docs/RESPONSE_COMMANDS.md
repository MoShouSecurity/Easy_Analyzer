# 应急响应命令兼容性

命令页保持 Windows/Linux 各 24 条、六类命令，支持离线浏览、搜索及复制。应用只复制文本，不在本机执行、安装工具、提权或修改远端系统。搜索覆盖用途、命令、适用说明、Shell 和权限。

## Linux：优先 BusyBox

复制到目标主机的 `sh` 或 BusyBox `ash` 中执行，也可在 Bash/dash 中使用。优先使用常见 BusyBox applet：`cat`、`ls`、`ps`、`netstat`、`ifconfig`、`route`、`find`、`grep`、`sed`、`awk`、`tr`、`head`、`tail`、`id`、`uname`、`date`、`mkdir`、`cp`、`stat` 和 `sha256sum`。

不要求 `sudo`、`lsof`、`pstree`、`getent`、`lastb`、Bash 专用语法或 GNU `find -printf`，不要求 systemd。BusyBox 的 applet 和选项可在构建时裁剪；工具缺失时尽量回退或明确提示，不能保证任意设备的 BusyBox 都包含完整工具集。仍需具备相应读取权限；查看其他用户进程或受限日志时，使用已有 root 终端或由管理员提供访问权限。

| 能力 | 基础路径和回退 |
| --- | --- |
| 进程 | 有 `ps` 时先探测格式支持；不支持时使用基础 `ps`，连 `ps` 都没有时读取 `/proc/*/status`。父 PID、可执行文件、命令行及 fd 直接读取 procfs。 |
| 网络 | 优先 `netstat`、`ifconfig`、`route`；缺失时尝试已安装的 `ss`/`ip`，再回退到 procfs。原始地址/端口按十六进制展示，不伪装为已解码结果。 |
| 进程归属 | `/proc/PID/fd` 的 `socket:[inode]` 与网络表对照；`/proc/PID/net` 是该进程所属网络命名空间的全部网络表，不能把整张表都归属于目标进程。 |
| 启动与定时任务 | 列出 init、OpenRC、cron/periodic 及 systemd wants/requires 配置。仅当 systemctl 存在且有 /run/systemd/system 时，补查 enabled 服务和全部 timer；不会启动服务或执行脚本。目录清单不等于运行状态，也不覆盖全部持久化机制。 |
| 登录与系统日志 | 仅访问存在的常见日志文件；成功登录历史的 `last` 先检查工具和可读 wtmp 存在，失败认证使用文本日志；若 lastb 存在且 btmp 可读，额外查询失败登录历史。系统日志缺失时可尝试 BusyBox `logread`；已运行 systemd 的环境可选用 journal 回退。 |
| 文件与留存 | 使用基础 `find -mtime -1 -print`、`stat`、`sha256sum` 和 `cp -p`；缺少 `stat` 时回退到 `ls`，缺少 SHA256 工具时明确提示，不以其他校验算法冒充 SHA256。 |

`/proc` 必须在目标环境可用，`hidepid`、容器和网络命名空间会影响可见范围。没有文件、没有权限、没有留存或没有工具均不能作为“没有异常”的依据。`who`/`last` 依赖实际登录记录；`logread` 依赖相应 syslogd 的配置和运行状态。文本查询仅展示部分匹配项及最近记录，轮转/压缩日志需另行导出核查。

进程示例用 `PROCESS_ID=$$` 默认检查当前 Shell，核查时替换为目标 PID。哈希/属性示例默认使用 `/etc/passwd`，文件查询默认使用 `/tmp`，请换成案件实际目标的绝对路径。启动脚本查询还覆盖 `/etc/profile.d/*`、`/etc/environment` 和当前用户的 `~/.bash_profile`，只展示原文，不执行配置内容。仅在未发现常见 cron 配置时输出缺失提示。

日志复制需先替换 `SOURCE_LOG`；输出目录必须全新，`mkdir` 不带 `-p`，已有目录时停止，不覆盖证据。`cp -p` 是否保留全部属性取决于权限；失败时保留原错误并明确提示副本未完成，不自动删除可能的部分副本。活动日志在复制期间仍可能变化。

## Windows

保留 Windows 10 / Server 2016+、Windows PowerShell 5.1 的基线。账号、网络、DNS 和计划任务查询优先使用内置 `net user`、`net localgroup`、`netstat`、`ipconfig`、`schtasks`，不要求 LocalAccounts、NetTCPIP、DnsClient 或 ScheduledTasks 模块。管理员组名称通过固定 SID 解析，避免依赖英文组名；域控制器不适用普通本地账号/组的语义。

进程、服务、事件和文件分析仍包含系统自带 PowerShell/CIM 命令；需在标注的 Shell 中运行。权限、WMI/CIM 服务状态、审计配置和日志留存会影响结果，不保证裁剪后的 Windows 环境提供所有能力。

## 验证与复现（2026-11-04）

使用 Docker 官方镜像，在 ARM64 的一次性容器中逐条运行本分支的 24 条 Linux 命令：

- `busybox:1.37`：24 条通过。
- 同一 BusyBox 镜像限制 PATH，只保留基础 applet，隐藏网络工具、uptime、who、last、crontab、stat、sha256sum，并让 ps 不接受扩展选项：24 条通过。
- `debian:bookworm-slim`：24 条通过，覆盖无 ps/网络工具时的 procfs 路径。

检查包括 shell 语法、执行状态、非空输出和无意外 stderr，以及复制日志不覆盖已有证据、缺失源文件时不创建输出目录，以及 last 可用但 wtmp 缺失时的明确提示。缺失工具时的明确提示也属于预期结果，不代表所有能力在该环境都可用。使用合成日志、启动和 cron 配置，未挂载本机真实证据、配置或案件；容器禁用网络、移除额外 capabilities，并在执行后删除。本轮未实机运行 Windows 命令，未覆盖所有 BusyBox 构建、发行版、权限配置或真实设备。

新增可选分支检查使用 `systemctl`、`lastb` 和失败 `cp` 的接口替身，覆盖工具存在但运行条件缺失、查询成功/失败、文本日志缺失时仍查询可读 btmp、复制失败提示，以及新启动路径只读不执行。这些替身不代表真实 systemd 主机或 btmp 解码验收。测试脚本改写参数时必须恰好命中一次；另有 3 项 Python 单元测试验证正常替换、缺失/改写格式和重复赋值。

已有 Docker 和 Node.js（支持 `--experimental-strip-types`）后，可运行：

```sh
docker pull busybox:1.37
docker pull debian:bookworm-slim
python3 scripts/check_response_commands_linux.py
python3 -m unittest discover -s scripts -p 'test_response_commands_linux.py'
npm --prefix crates/analyzer-gui/frontend test
npm --prefix crates/analyzer-gui/frontend run build
npm --prefix crates/analyzer-gui/frontend run format:check
```

容器脚本只挂载临时生成的命令脚本（只读），不自动下载镜像；需先执行上面的 pull。

## 语法与语义参考

- [BusyBox applet 文档](https://busybox.net/downloads/BusyBox.html)
- [Linux proc_pid_fd：文件描述符和 socket inode](https://man7.org/linux/man-pages/man5/proc_pid_fd.5.html)
- [Linux proc_pid_net：网络命名空间与原始网络表](https://man7.org/linux/man-pages/man5/proc_pid_net.5.html)
- [Microsoft netstat](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/netstat)
- [Microsoft schtasks query](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-query)

- [systemd systemctl 查询命令](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html)
