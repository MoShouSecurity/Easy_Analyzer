export type CommandPlatform = "windows" | "linux";
export const commandCategories = [
  { value: "system", label: "系统与账号" },
  { value: "process", label: "进程排查" },
  { value: "network", label: "网络排查" },
  { value: "persistence", label: "持久化排查" },
  { value: "logs", label: "日志排查" },
  { value: "files", label: "文件与取证" },
] as const;
export type CommandCategory = (typeof commandCategories)[number]["value"];
export interface ResponseCommand {
  id: string;
  platform: CommandPlatform;
  category: CommandCategory;
  title: string;
  description: string;
  shell: "PowerShell" | "CMD" | "Bash";
  permission: string;
  command: string;
  notes: string;
}
function windows(
  id: string,
  category: CommandCategory,
  title: string,
  description: string,
  command: string,
  notes: string,
  permission = "普通用户；管理员可读取更多信息",
  shell: ResponseCommand["shell"] = "PowerShell",
): ResponseCommand {
  return {
    id: `windows-${id}`,
    platform: "windows",
    category,
    title,
    description,
    shell,
    permission,
    command,
    notes,
  };
}
function linux(
  id: string,
  category: CommandCategory,
  title: string,
  description: string,
  command: string,
  notes: string,
  permission = "普通用户",
): ResponseCommand {
  return {
    id: `linux-${id}`,
    platform: "linux",
    category,
    title,
    description,
    shell: "Bash",
    permission,
    command,
    notes,
  };
}

// Windows baseline: 64-bit Windows PowerShell 5.1, Windows 10 / Server 2016+.
// Syntax references: Microsoft Learn Windows commands and PowerShell modules
// (CimCmdlets, NetTCPIP, LocalAccounts, ScheduledTasks, Diagnostics, Utility, Security).
// https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/wevtutil
// https://learn.microsoft.com/en-us/powershell/module/cimcmdlets/get-ciminstance
// https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.diagnostics/get-winevent
// Linux references: procps-ng, util-linux, iproute2, lsof, GNU coreutils/findutils,
// Cronie and systemd manuals. Availability is stated per entry; nothing is installed.
// https://man7.org/linux/man-pages/man8/ss.8.html
// https://man7.org/linux/man-pages/man8/lsof.8.html
// https://www.freedesktop.org/software/systemd/man/255/journalctl.html
// https://www.gnu.org/software/coreutils/manual/coreutils.html
export const responseCommands: readonly ResponseCommand[] = [
  windows(
    "system-info",
    "system",
    "查看系统信息",
    "查看操作系统版本、主机名、安装时间及补丁等基础信息。",
    "systeminfo",
    "Windows 内置命令。输出可能包含内网配置，留存时按案件要求处理。",
    "普通用户",
    "CMD",
  ),
  windows(
    "identity",
    "system",
    "查看当前身份与权限",
    "列出当前账号、组成员关系及令牌权限。",
    "whoami /all",
    "查看当前终端的身份；以管理员运行的终端与普通终端结果可能不同。",
    "普通用户",
    "CMD",
  ),
  windows(
    "local-users",
    "system",
    "查看本地账号",
    "核查账号是否启用、最近登录时间及密码设置时间。",
    "Get-LocalUser | Select-Object Name, Enabled, LastLogon, PasswordLastSet, Description",
    "需要 LocalAccounts 模块和 64 位 PowerShell；域控制器没有普通本地账号库。",
  ),
  windows(
    "administrators",
    "system",
    "查看本地管理员组成员",
    "核查本地 Administrators 组中是否存在非预期账号。",
    "Get-LocalGroup -SID 'S-1-5-32-544' | Get-LocalGroupMember",
    "按固定 SID 查询，兼容不同语言的组名；需要 LocalAccounts 模块，不适用于域控制器。",
  ),

  windows(
    "process-command",
    "process",
    "查看进程路径与命令行",
    "列出进程名称、PID、可执行路径及完整命令行。",
    "Get-CimInstance Win32_Process |\n  Select-Object Name, ProcessId, ExecutablePath, CommandLine",
    "部分受保护进程的路径和命令行可能为空；不要把字段缺失直接认定为异常。",
  ),
  windows(
    "process-parent",
    "process",
    "查看进程父子关系",
    "按父 PID 查看进程关系及创建时间，辅助核对异常启动链。",
    "Get-CimInstance Win32_Process |\n  Sort-Object ParentProcessId, ProcessId |\n  Select-Object Name, ProcessId, ParentProcessId, CreationDate",
    "这是当前进程快照；父进程可能已退出，PID 可能被复用，需结合创建时间核查。",
  ),
  windows(
    "process-service",
    "process",
    "查看进程关联服务",
    "列出运行进程及其承载的服务名称。",
    "tasklist /svc",
    "Windows 内置命令；多个服务可能由同一个 svchost.exe 承载。",
    "普通用户；管理员可读取更多信息",
    "CMD",
  ),
  windows(
    "process-modules",
    "process",
    "查看指定进程加载模块",
    "核查指定进程加载的 DLL 路径和文件版本。",
    "$ProcessId = 1234\nGet-Process -Id $ProcessId -Module |\n  Select-Object ModuleName, FileName, FileVersionInfo",
    "将 1234 替换为目标 PID。建议使用 64 位 PowerShell；受保护进程或跨位数访问可能失败。",
    "管理员；受保护进程仍可能不可读",
  ),

  windows(
    "tcp",
    "network",
    "查看 TCP 连接",
    "查看连接地址、端口、状态及所属进程 PID。",
    "Get-NetTCPConnection |\n  Sort-Object State, OwningProcess |\n  Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort, State, OwningProcess",
    "需要 NetTCPIP 模块；OwningProcess 可与进程清单中的 PID 对照。",
  ),
  windows(
    "udp",
    "network",
    "查看 UDP 端点",
    "查看本机 UDP 绑定地址、端口及所属 PID。",
    "Get-NetUDPEndpoint |\n  Select-Object LocalAddress, LocalPort, OwningProcess",
    "需要 NetTCPIP 模块；UDP 端点列表不会提供完整的远端通信历史。",
  ),
  windows(
    "ip-config",
    "network",
    "查看网络配置",
    "查看网卡、IP 地址、默认网关及 DNS 服务器。",
    "Get-NetIPConfiguration -Detailed",
    "需要 NetTCPIP 模块；仅查询当前配置，不修改网卡或路由。",
    "普通用户",
  ),
  windows(
    "dns-cache",
    "network",
    "查看 DNS 缓存",
    "核查主机最近缓存的域名解析记录。",
    "Get-DnsClientCache",
    "需要 DnsClient 模块；缓存会过期，不能代表完整 DNS 访问历史。",
    "普通用户",
  ),

  windows(
    "services",
    "persistence",
    "查看服务配置",
    "核查服务可执行路径、启动账号、启动方式和状态。",
    "Get-CimInstance Win32_Service |\n  Select-Object Name, State, StartMode, StartName, PathName",
    "关注非预期路径和账号；查询不会启动、停止或修改服务。",
  ),
  windows(
    "tasks",
    "persistence",
    "查看计划任务及动作",
    "列出计划任务的程序、参数和触发器。",
    "Get-ScheduledTask |\n  Select-Object TaskPath, TaskName, State, Actions, Triggers |\n  Format-List",
    "需要 ScheduledTasks 模块。管理员可查看更多任务；Actions 和 Triggers 需结合任务用途核查。",
  ),
  windows(
    "run-keys",
    "persistence",
    "查看 Run 注册表启动项",
    "查询当前用户、系统及 32 位程序的 Run/RunOnce 项。",
    String.raw`$Keys = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\RunOnce'
)
foreach ($Key in $Keys) {
  if (Test-Path -LiteralPath $Key) {
    Get-ItemProperty -LiteralPath $Key | Format-List
  }
}`,
    "HKCU 仅代表运行终端的账号；此清单不覆盖其他用户和所有持久化方式。",
  ),
  windows(
    "startup",
    "persistence",
    "查看启动项",
    "查看 WMI 可见的启动命令、所属用户和配置位置。",
    "Get-CimInstance Win32_StartupCommand |\n  Select-Object Name, Command, Location, User",
    "查询 Win32_StartupCommand；结果不是全部自启动机制的完整清单。",
  ),

  windows(
    "login-events",
    "logs",
    "查看登录成功与失败事件",
    "查询最近一天的 4624、4625 事件，核对账号、来源和登录类型。",
    "Get-WinEvent -FilterHashtable @{\n  LogName = 'Security'; Id = 4624,4625; StartTime = (Get-Date).AddDays(-1)\n} -MaxEvents 200 | Format-List TimeCreated, Id, Message",
    "可调整 AddDays(-1) 和 MaxEvents。依赖审计启用及日志留存；查询无结果不能证明没有登录活动。",
    "管理员或具有 Security 日志读取权限",
  ),
  windows(
    "log-clear",
    "logs",
    "查看审计日志清除事件",
    "查询 Security 日志中的 1102 事件，核对清除时间和操作主体。",
    "Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 1102 } -MaxEvents 100 |\n  Format-List TimeCreated, Id, Message",
    "1102 是 Security 日志清除线索；结合授权维护和其他日志核查。日志轮转或被覆盖可能导致记录缺失。",
    "管理员或具有 Security 日志读取权限",
  ),
  windows(
    "service-events",
    "logs",
    "查看服务安装事件",
    "查询 System 日志中的 7045 事件，核查新服务配置。",
    "Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 7045 } -MaxEvents 100 |\n  Format-List TimeCreated, Id, Message",
    "7045 表示服务安装，不直接证明恶意持久化；需核对安装来源、路径和维护记录。",
  ),
  windows(
    "powershell-events",
    "logs",
    "查看 PowerShell 脚本事件",
    "查看 PowerShell Operational 通道的 4104 脚本块记录。",
    "Get-WinEvent -FilterHashtable @{\n  LogName = 'Microsoft-Windows-PowerShell/Operational'; Id = 4104\n} -MaxEvents 100 | Format-List TimeCreated, Id, Message",
    "只有启用相应脚本块日志且记录仍被保留时才有结果；脚本块可能分多条事件记录。",
  ),

  windows(
    "hash",
    "files",
    "计算文件 SHA256",
    "计算目标文件摘要，用于证据完整性校验和后续比对。",
    String.raw`$TargetPath = 'C:\path\sample.exe'
Get-FileHash -LiteralPath $TargetPath -Algorithm SHA256`,
    "将 C:\\path\\sample.exe 替换为目标文件路径。只读取文件；哈希本身不能判断文件是否恶意。",
    "对目标文件有读取权限",
  ),
  windows(
    "signature",
    "files",
    "查看文件数字签名",
    "查看 Authenticode 签名状态、签名者及证书信息。",
    String.raw`$TargetPath = 'C:\path\sample.exe'
Get-AuthenticodeSignature -LiteralPath $TargetPath | Format-List`,
    "替换目标路径。签名有效不等于文件安全，未签名也不等于恶意；应结合内容和来源核查。",
    "对目标文件有读取权限",
  ),
  windows(
    "recent-files",
    "files",
    "查找近期修改文件",
    "在指定目录内查找最近一天修改的文件。",
    String.raw`$SearchRoot = 'C:\path\directory'
Get-ChildItem -LiteralPath $SearchRoot -File -Recurse -Force |
  Where-Object { $_.LastWriteTime -ge (Get-Date).AddDays(-1) } |
  Select-Object FullName, Length, CreationTime, LastWriteTime`,
    "替换目录和时间范围；递归查询大目录可能耗时，权限不足的目录会报错。文件时间可被修改，仅作线索。",
    "对目标目录有读取权限",
  ),
  windows(
    "export-evtx",
    "files",
    "导出 Security EVTX",
    "将 Security 日志导出为可供离线分析的 EVTX 文件。",
    String.raw`wevtutil epl Security "C:\Evidence\Security.evtx" /ow:false`,
    "先准备 C:\\Evidence 目录并替换输出路径；写入新的 EVTX，目标已存在时拒绝覆盖，不清除源日志。活动日志仍可能变化。",
    "管理员或具有日志读取及目标目录写入权限",
    "CMD",
  ),

  linux(
    "system-info",
    "system",
    "查看系统版本",
    "查看内核、架构和发行版标识。",
    "uname -a\ncat /etc/os-release",
    "需要 uname 和 cat；部分较旧或精简系统可能没有 /etc/os-release。",
  ),
  linux(
    "uptime",
    "system",
    "查看启动时间与负载",
    "查看启动时间、运行时长和当前负载。",
    "uptime -s\nuptime",
    "需要 procps-ng 的 uptime；-s 不一定被 BusyBox 版本支持。",
  ),
  linux(
    "accounts",
    "system",
    "查看系统账号清单",
    "查询 NSS 可见账号及 UID、家目录和登录 Shell。",
    "getent passwd",
    "需要 getent；结果可能包含 LDAP 等目录服务账号，不局限于 /etc/passwd。",
  ),
  linux(
    "logged-in",
    "system",
    "查看当前登录用户",
    "查看登录用户、来源、终端及当前活动。",
    "who -a\nw",
    "需要 GNU coreutils 的 who 和 procps-ng 的 w；依赖 utmp，容器或部分精简系统可能没有记录。",
  ),

  linux(
    "processes",
    "process",
    "查看进程清单",
    "查看账号、PID、PPID、启动时间及完整进程参数。",
    "ps -eo user,pid,ppid,lstart,args --forest",
    "需要 procps-ng；--forest 不一定被 BusyBox ps 支持。",
    "普通用户；root 可读取更多进程信息",
  ),
  linux(
    "process-tree",
    "process",
    "查看进程树",
    "查看进程层级、PID 和启动参数。",
    "pstree -ap",
    "需要 psmisc 的 pstree；部分进程参数受权限和 /proc 挂载选项限制。",
    "普通用户；root 可读取更多进程信息",
  ),
  linux(
    "process-files",
    "process",
    "查看指定进程打开文件",
    "核查目标进程打开的文件、设备和套接字。",
    'PROCESS_ID=1234\nsudo lsof -nP -p "$PROCESS_ID"',
    "将 1234 替换为目标 PID；需要 lsof 和 sudo，也可由 root 直接运行 lsof。",
    "root；或具备 sudo 权限",
  ),
  linux(
    "process-command",
    "process",
    "查看进程路径与命令行",
    "读取目标进程的可执行路径及 NUL 分隔的完整参数。",
    "PROCESS_ID=1234\nsudo readlink -f \"/proc/$PROCESS_ID/exe\"\nsudo cat \"/proc/$PROCESS_ID/cmdline\" | tr '\\0' ' '\nprintf '\\n'",
    "替换 PID。需要挂载 procfs、coreutils 和 sudo；进程退出后路径会消失，exe 的 deleted 标记需进一步核查。",
    "目标进程所属用户或 root；示例使用 sudo",
  ),

  linux(
    "connections",
    "network",
    "查看当前 TCP/UDP 连接",
    "列出当前连接和所属进程，辅助核对非预期出站通信。",
    "sudo ss -antup",
    "需要 iproute2 和 sudo；-p 的进程信息受权限限制，连接列表不是通信历史。",
    "root；或具备 sudo 权限",
  ),
  linux(
    "listeners",
    "network",
    "查看监听端口",
    "核查 TCP/UDP 监听地址、端口及所属进程。",
    "sudo ss -lntup",
    "需要 iproute2；0.0.0.0 或 :: 监听是否可从外部访问，还取决于防火墙和网络配置。",
    "root；或具备 sudo 权限",
  ),
  linux(
    "ip-route",
    "network",
    "查看地址与路由",
    "查看网卡地址、IPv4 和 IPv6 路由。",
    "ip -br address\nip route show\nip -6 route show",
    "需要 iproute2；-br 为简洁输出，较旧版本可改为 ip address show。",
  ),
  linux(
    "network-processes",
    "network",
    "查看进程网络连接",
    "通过打开的网络文件核查进程与连接的关系。",
    "sudo lsof -nP -i",
    "需要 lsof 和 sudo；-nP 禁止名称解析，结果保留数字地址和端口。",
    "root；或具备 sudo 权限",
  ),

  linux(
    "enabled-services",
    "persistence",
    "查看开机启用服务",
    "查看 systemd 中设置为 enabled 的服务单元。",
    "systemctl list-unit-files --type=service --state=enabled --no-pager",
    "仅适用于 systemd；enabled 不代表当前正在运行，也不覆盖静态单元或其他启动机制。",
  ),
  linux(
    "timers",
    "persistence",
    "查看 systemd 定时器",
    "核查定时器、对应服务以及上次和下次触发时间。",
    "systemctl list-timers --all --no-pager",
    "仅适用于 systemd；这是系统管理器的定时器，用户级定时器需另用 systemctl --user 查询。",
  ),
  linux(
    "user-crontab",
    "persistence",
    "查看指定用户 crontab",
    "核查指定账号设置的周期任务。",
    'ACCOUNT_NAME=root\nsudo crontab -u "$ACCOUNT_NAME" -l',
    "将 root 替换为目标账号；需要 cron/Cronie 和 sudo。提示 no crontab 仅表示该账号未配置用户 crontab。",
    "root；或具备 sudo 权限",
  ),
  linux(
    "system-cron",
    "persistence",
    "查看系统 cron 配置",
    "查看系统 crontab、cron.d 配置及周期脚本目录清单。",
    'sudo cat /etc/crontab\nsudo find /etc/cron.d -maxdepth 1 -type f -exec sh -c \'printf "\\n--- %s ---\\n" "$1"; cat -- "$1"\' sh {} \\;\nsudo ls -la /etc/cron.hourly /etc/cron.daily /etc/cron.weekly /etc/cron.monthly',
    "目录布局依发行版而异，不存在时会报错；这里只读取配置和列出文件，不运行周期脚本。",
    "root；或具备 sudo 权限",
  ),

  linux(
    "login-success",
    "logs",
    "查看成功登录历史",
    "查看 wtmp 中保存的登录和重启记录，保留来源地址。",
    "last -Fai",
    "需要 util-linux 的 last，依赖 wtmp；部分发行版改用 wtmpdb，日志轮转或缺失会影响覆盖范围。",
  ),
  linux(
    "login-failure",
    "logs",
    "查看失败登录历史",
    "查看 btmp 中保存的失败登录记录。",
    "sudo lastb -Fai",
    "需要 util-linux 的 lastb，依赖 btmp；未记录或文件缺失不能证明没有失败登录。",
    "root；或具备 btmp 读取权限",
  ),
  linux(
    "ssh-auth",
    "logs",
    "查看 SSH 认证日志",
    "在常见认证日志路径中查找 sshd 的登录与认证记录。",
    "sudo grep -E 'sshd.*(Accepted|Failed|Invalid user|authentication failure)' /var/log/auth.log /var/log/secure",
    "Debian/Ubuntu 常用 auth.log，RHEL 系常用 secure；不存在的路径会报错。仅使用 journal 的系统可查询 journalctl -t sshd；轮转日志需另行检查。",
    "root；或具备认证日志读取权限",
  ),
  linux(
    "journal-range",
    "logs",
    "查看指定时间段系统日志",
    "按开始和结束时间查询 systemd journal，输出带时区的时间。",
    "START_TIME='2026-10-13 00:00:00'\nEND_TIME='2026-10-13 23:59:59'\nsudo journalctl --since \"$START_TIME\" --until \"$END_TIME\" --output=short-iso-precise --no-pager",
    "替换两个时间值，未指定时区时按目标主机本地时区解释。需要 systemd；较旧版本可改用 short-iso。",
    "root；或具备 journal 读取权限",
  ),

  linux(
    "hash",
    "files",
    "计算文件 SHA256",
    "计算目标文件摘要，便于证据完整性校验及比对。",
    "TARGET_PATH='/path/to/sample'\nsha256sum -- \"$TARGET_PATH\"",
    "替换目标路径；需要 GNU coreutils。只读取文件，哈希本身不能判断恶意性。",
    "对目标文件有读取权限",
  ),
  linux(
    "file-stat",
    "files",
    "查看文件时间与权限",
    "查看权限、所有者、大小、访问/修改/元数据变更时间及 inode。",
    "TARGET_PATH='/path/to/sample'\nstat -- \"$TARGET_PATH\"",
    "替换目标路径；需要 GNU coreutils。ctime 是元数据变更时间，不是文件创建时间。",
    "对目标路径有访问权限",
  ),
  linux(
    "recent-files",
    "files",
    "查找近期修改文件",
    "在指定目录内查找最近一天修改的普通文件。",
    "SEARCH_ROOT='/path/to/directory'\nsudo find \"$SEARCH_ROOT\" -xdev -type f -mtime -1 -printf '%TY-%Tm-%Td %TH:%TM:%TS %p\\n'",
    "替换搜索目录；需要 GNU findutils。-xdev 不跨文件系统，-mtime -1 表示最近 24 小时；大目录可能耗时。",
    "对目标目录有读取权限；示例使用 sudo",
  ),
  linux(
    "copy-logs",
    "files",
    "复制日志留存",
    "在新建的取证目录中留存指定日志，保留文件属性。",
    'SOURCE_LOG=\'/var/log/auth.log\'\nEVIDENCE_DIR=\'/path/to/new-evidence-directory\'\nsudo mkdir -m 700 -- "$EVIDENCE_DIR" &&\n  sudo cp -a --no-clobber -- "$SOURCE_LOG" "$EVIDENCE_DIR/"',
    "替换源日志及新目录路径。需要 GNU coreutils 和 sudo；写入取证目录，不覆盖已有文件；目录已存在时停止。活动日志复制期间可能变化。",
    "root；或具备源日志读取及目标目录写入权限",
  ),
];
