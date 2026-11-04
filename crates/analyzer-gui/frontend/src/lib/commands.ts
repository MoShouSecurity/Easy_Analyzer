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
  shell: "PowerShell" | "CMD" | "sh";
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
    shell: "sh",
    permission,
    command,
    notes,
  };
}

// Windows baseline: 64-bit Windows PowerShell 5.1, Windows 10 / Server 2016+.
// Syntax references: Microsoft Learn Windows commands and PowerShell modules
// (CimCmdlets, Diagnostics, Utility, Security); account/network/task lists prefer
// built-in net.exe, netstat.exe, ipconfig.exe and schtasks.exe.
// https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/wevtutil
// https://learn.microsoft.com/en-us/powershell/module/cimcmdlets/get-ciminstance
// https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.diagnostics/get-winevent
// Linux baseline: POSIX sh / BusyBox ash and common BusyBox applets.
// BusyBox applets/options are build-time choices; missing tools/files are reported.
// https://busybox.net/downloads/BusyBox.html
// https://man7.org/linux/man-pages/man5/proc_pid_fd.5.html
// https://man7.org/linux/man-pages/man5/proc_pid_net.5.html
// https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/netstat
// https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-query
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
    "列出本机账号；需要具体账号详情时再运行 net user 账号名。",
    "net user",
    "Windows 内置命令，不依赖 LocalAccounts 模块。普通成员主机查询本地账号；域控制器上的账号语义不同。",
    "普通用户",
    "CMD",
  ),
  windows(
    "administrators",
    "system",
    "查看本地管理员组成员",
    "按固定 SID 解析管理员组名称，兼容不同语言的系统。",
    "$GroupName = ([System.Security.Principal.SecurityIdentifier]'S-1-5-32-544').Translate([System.Security.Principal.NTAccount]).Value.Split('\\')[-1]\nnet localgroup \"$GroupName\"",
    "使用 Windows PowerShell 内置 .NET 类型与 net.exe，不依赖 LocalAccounts 模块；不适用于没有普通本地组的域控制器。",
    "普通用户；管理员可读取更多信息",
    "PowerShell",
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
    "查看 TCP 地址、端口、状态及所属 PID，包含监听端口。",
    "netstat -ano -p tcp\nnetstat -ano -p tcpv6",
    "Windows 内置 netstat，分别查询 IPv4/IPv6。末列 PID 可与 tasklist 对照；连接表不是历史记录。",
    "普通用户；管理员可读取更多信息",
    "CMD",
  ),
  windows(
    "udp",
    "network",
    "查看 UDP 端点",
    "查看 IPv4/IPv6 UDP 绑定地址、端口及所属 PID。",
    "netstat -ano -p udp\nnetstat -ano -p udpv6",
    "Windows 内置 netstat，不依赖 NetTCPIP 模块；UDP 端点不代表完整的远端通信历史。",
    "普通用户；管理员可读取更多信息",
    "CMD",
  ),
  windows(
    "ip-config",
    "network",
    "查看网络配置",
    "查看网卡、IP、网关和 DNS 配置。",
    "ipconfig /all",
    "Windows 内置命令，仅查询配置，不修改网卡或路由。",
    "普通用户",
    "CMD",
  ),
  windows(
    "dns-cache",
    "network",
    "查看 DNS 缓存",
    "核查主机当前缓存的域名解析记录。",
    "ipconfig /displaydns",
    "Windows 内置命令，不依赖 DnsClient 模块；缓存可能为空或已过期，不能代表全部访问历史。",
    "普通用户",
    "CMD",
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
    "以详细列表查看任务执行程序、参数、计划和运行账号。",
    "schtasks /query /fo LIST /v",
    "Windows 内置命令，不依赖 ScheduledTasks 模块；管理员可查看更多任务，不创建或运行任务。",
    "普通用户；管理员可读取更多信息",
    "CMD",
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
    "查看内核、架构和可用的发行版标识。",
    `uname -a
if [ -r /etc/os-release ]; then
  cat /etc/os-release
elif [ -r /etc/issue ]; then
  cat /etc/issue
else
  printf '%s\\n' '没有可读的发行版标识文件。'
fi`,
    "使用 uname、cat 和 sh；不存在 /etc/os-release 时读取 /etc/issue，不要求额外安装发行版工具。",
    "普通用户",
  ),
  linux(
    "uptime",
    "system",
    "查看运行时长与负载",
    "查看运行时长、在线用户数及系统负载；缺少 uptime 时读取内核数据。",
    `if command -v uptime >/dev/null 2>&1; then
  uptime
else
  for INFO_FILE in /proc/uptime /proc/loadavg; do
    if [ -r "$INFO_FILE" ]; then
      printf '\\n--- %s ---\\n' "$INFO_FILE"
      cat "$INFO_FILE"
    else
      printf '无法读取 %s，请检查 procfs 和权限。\\n' "$INFO_FILE"
    fi
  done
fi`,
    "不使用 uptime -s。/proc/uptime 第一列是启动后秒数；容器中的运行时长可能对应宿主内核。",
    "普通用户",
  ),
  linux(
    "accounts",
    "system",
    "查看系统账号清单",
    "读取本地账号和组配置，核对 UID、GID、家目录与登录 Shell。",
    `for ACCOUNT_FILE in /etc/passwd /etc/group; do
  if [ -r "$ACCOUNT_FILE" ]; then
    printf '\\n--- %s ---\\n' "$ACCOUNT_FILE"
    cat "$ACCOUNT_FILE"
  else
    printf '无法读取 %s，请检查文件和权限。\\n' "$ACCOUNT_FILE"
  fi
done`,
    "只需 cat；不依赖 getent。结果仅覆盖本地文件，不包含 LDAP 等目录服务中的全部账号。",
    "普通用户",
  ),
  linux(
    "logged-in",
    "system",
    "查看当前身份与登录用户",
    "查看当前终端身份和系统保存的在线登录会话。",
    `id
if command -v who >/dev/null 2>&1; then
  who
else
  printf '%s\\n' '没有 who；只能确认上方当前终端身份，无法列出全部登录会话。'
fi`,
    "不使用 who -a 或 w。who 依赖 utmp；空输出可能是未留存会话记录，不能据此认定没有远程登录。",
    "普通用户",
  ),
  linux(
    "processes",
    "process",
    "查看进程清单",
    "优先查看 PID、PPID、账号和参数；精简 ps 使用基础输出，无 ps 时读取 /proc。",
    `if command -v ps >/dev/null 2>&1; then
  if ps -eo pid,ppid,user,args >/dev/null 2>&1; then
    ps -eo pid,ppid,user,args
  else
    ps
  fi
elif [ -d /proc/1 ]; then
  printf '%s\\n' '没有 ps，以下从 /proc 读取名称、PID、PPID 与数值 UID。'
  for PROCESS_DIR in /proc/[0-9]*; do
    if [ -r "$PROCESS_DIR/status" ]; then
      printf '\\n--- %s ---\\n' "$PROCESS_DIR"
      sed -n '/^Name:/p; /^Pid:/p; /^PPid:/p; /^Uid:/p' "$PROCESS_DIR/status"
    fi
  done
else
  printf '%s\\n' '没有 ps 或可用的 procfs，无法枚举进程。'
fi`,
    "兼容常见 BusyBox/procps ps，不使用 --forest、lstart 等扩展。基础 ps 的列和覆盖范围依实现而异；/proc 回退只显示可读进程的名称、PID、PPID 和数值 UID。",
    "普通用户；root 可读取更多进程信息",
  ),
  linux(
    "process-parent",
    "process",
    "查看进程父 PID",
    "从 /proc 读取进程名称、PID、PPID 和数值 UID，核对启动关系。",
    `if [ -d /proc/1 ]; then
  for PROCESS_DIR in /proc/[0-9]*; do
    if [ -r "$PROCESS_DIR/status" ]; then
      printf '\\n--- %s ---\\n' "$PROCESS_DIR"
      sed -n '/^Name:/p; /^Pid:/p; /^PPid:/p; /^Uid:/p' "$PROCESS_DIR/status"
    fi
  done
else
  printf '%s\\n' '没有可用的 procfs，请先确认 /proc 挂载情况。'
fi`,
    "只需 sh、sed 和 procfs，不依赖 pstree。输出是瞬时快照；进程退出、PID 复用和 hidepid 会影响结果，不能只凭 PPID 判断攻击链。",
    "普通用户；root 可读取更多进程信息",
  ),
  linux(
    "process-files",
    "process",
    "查看指定进程打开文件",
    "查看目标进程的文件描述符及链接到的文件、管道和套接字。",
    `PROCESS_ID=$$ # 默认当前 Shell，替换为要检查的 PID
if [ -d "/proc/$PROCESS_ID/fd" ]; then
  ls -l "/proc/$PROCESS_ID/fd"
else
  printf '%s\\n' '进程已退出、PID 不存在，或没有读取 /proc 的权限。'
fi`,
    "使用 ls 和 procfs，不依赖 lsof/sudo；socket:[数字] 是套接字 inode。访问其他用户的进程通常需要 root。",
    "目标进程所属用户或 root",
  ),
  linux(
    "process-command",
    "process",
    "查看进程路径与命令行",
    "读取进程可执行文件链接，并展开 NUL 分隔的命令行参数。",
    `PROCESS_ID=$$ # 默认当前 Shell，替换为要检查的 PID
if [ -d "/proc/$PROCESS_ID" ]; then
  ls -l "/proc/$PROCESS_ID/exe"
  if [ -r "/proc/$PROCESS_ID/cmdline" ]; then
    tr '\\000' ' ' < "/proc/$PROCESS_ID/cmdline"
    printf '\\n'
  else
    printf '%s\\n' '无法读取命令行，请检查进程状态和权限。'
  fi
else
  printf '%s\\n' 'PID 不存在，或 procfs 不可用。'
fi`,
    "使用 ls、tr 和 procfs；不要求 readlink -f。内核线程的 cmdline 可能为空；空字段或 deleted 标记需结合进程状态核查。",
    "目标进程所属用户或 root",
  ),
  linux(
    "connections",
    "network",
    "查看当前 TCP/UDP 连接",
    "查看数字地址、端口和连接状态；工具缺失时保留内核原始表。",
    `if command -v netstat >/dev/null 2>&1; then
  netstat -antu
elif command -v ss >/dev/null 2>&1; then
  ss -antu
else
  printf '%s\\n' '没有 netstat/ss，以下为原始表；地址与端口采用十六进制。'
  for SOCKET_TABLE in /proc/net/tcp /proc/net/tcp6 /proc/net/udp /proc/net/udp6; do
    if [ -r "$SOCKET_TABLE" ]; then
      printf '\\n--- %s ---\\n' "$SOCKET_TABLE"
      cat "$SOCKET_TABLE"
    fi
  done
fi`,
    "优先使用 BusyBox netstat 支持的 -antu；不要求 -p。/proc/net 只代表当前网络命名空间，不是通信历史；进程归属需另对照套接字 inode。",
    "普通用户",
  ),
  linux(
    "listeners",
    "network",
    "查看监听端口",
    "查看 TCP 监听及 UDP 绑定；没有网络工具时读取对应的内核表。",
    `if command -v netstat >/dev/null 2>&1; then
  netstat -lntu
elif command -v ss >/dev/null 2>&1; then
  ss -lntu
else
  printf '%s\\n' '没有 netstat/ss，以下地址和端口为十六进制。'
  for SOCKET_TABLE in /proc/net/tcp /proc/net/tcp6; do
    if [ -r "$SOCKET_TABLE" ]; then
      printf '\\n--- TCP LISTEN: %s ---\\n' "$SOCKET_TABLE"
      awk 'NR == 1 || $4 == "0A"' "$SOCKET_TABLE"
    fi
  done
  for SOCKET_TABLE in /proc/net/udp /proc/net/udp6; do
    if [ -r "$SOCKET_TABLE" ]; then
      printf '\\n--- UDP 绑定表: %s ---\\n' "$SOCKET_TABLE"
      cat "$SOCKET_TABLE"
    fi
  done
fi`,
    "不使用 sudo；UDP 表包含绑定及已连接套接字。0.0.0.0/:: 监听不等于外部一定可访问，还需核查防火墙、网络命名空间和网络配置。",
    "普通用户",
  ),
  linux(
    "ip-route",
    "network",
    "查看地址与路由",
    "优先使用 BusyBox 常见的 ifconfig/route，缺失时尝试 ip 或内核原始信息。",
    `if command -v ifconfig >/dev/null 2>&1; then
  ifconfig -a
elif command -v ip >/dev/null 2>&1; then
  ip address show
else
  printf '%s\\n' '没有 ifconfig/ip，以下仅为接口计数，不是完整 IP 地址列表。'
  if [ -r /proc/net/dev ]; then cat /proc/net/dev; fi
fi
if command -v route >/dev/null 2>&1; then
  route -n
elif command -v ip >/dev/null 2>&1; then
  ip route show
else
  printf '%s\\n' '没有 route/ip，以下为原始 IPv4 路由表，地址为十六进制。'
  if [ -r /proc/net/route ]; then cat /proc/net/route; fi
fi
if [ -r /proc/net/if_inet6 ]; then
  printf '\\n%s\\n' '--- 原始 IPv6 接口地址（十六进制）---'
  cat /proc/net/if_inet6
fi
if [ -r /proc/net/ipv6_route ]; then
  printf '\\n%s\\n' '--- 原始 IPv6 路由（十六进制）---'
  cat /proc/net/ipv6_route
fi`,
    "不使用 ip -br。ifconfig/route 取决于 BusyBox 构建选项；原始 IPv6 表保留完整数值但不解码。",
    "普通用户",
  ),
  linux(
    "network-processes",
    "network",
    "核对进程套接字与网络表",
    "将进程 fd 中的 socket inode 与同一网络命名空间的网络表对照。",
    `PROCESS_ID=$$ # 默认当前 Shell，替换为要检查的 PID
if [ -d "/proc/$PROCESS_ID/fd" ]; then
  printf '%s\\n' '--- 进程文件描述符：关注 socket:[inode] ---'
  ls -l "/proc/$PROCESS_ID/fd"
  for SOCKET_TABLE in "/proc/$PROCESS_ID/net/tcp" "/proc/$PROCESS_ID/net/tcp6" "/proc/$PROCESS_ID/net/udp" "/proc/$PROCESS_ID/net/udp6" "/proc/$PROCESS_ID/net/unix"; do
    if [ -r "$SOCKET_TABLE" ]; then
      printf '\\n--- %s ---\\n' "$SOCKET_TABLE"
      cat "$SOCKET_TABLE"
    fi
  done
else
  printf '%s\\n' '进程不存在或没有读取权限，请核对 PID 和权限。'
fi`,
    "只使用 ls/cat；/proc/PID/net 包含该进程网络命名空间的全部套接字，并非全部属于该进程，必须按 fd 的 inode 对照；原始地址/端口未解码。",
    "目标进程所属用户或 root",
  ),
  linux(
    "startup-services",
    "persistence",
    "查看启动服务配置",
    "列出常见 SysV、OpenRC 和 systemd 的启动配置路径，不执行脚本。",
    `FOUND_CONFIG=0
for CONFIG_DIR in /etc/init.d /etc/rc*.d /etc/runlevels/* /etc/systemd/system /etc/systemd/system/*.wants /etc/systemd/system/*.requires /usr/lib/systemd/system /lib/systemd/system; do
  if [ -d "$CONFIG_DIR" ]; then
    FOUND_CONFIG=1
    printf '\\n--- %s ---\\n' "$CONFIG_DIR"
    ls -la "$CONFIG_DIR"
  fi
done
if [ "$FOUND_CONFIG" -eq 0 ]; then
  printf '%s\\n' '没有发现这些常见启动目录；请核查该系统实际使用的 init。'
fi
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  printf '\\n%s\\n' '--- systemd 已启用服务 ---'
  if ! systemctl list-unit-files --type=service --state=enabled --no-pager; then
    printf '%s\\n' '服务启用状态查询失败，请核查 systemd 状态、权限及前面的错误。'
  fi
  printf '\\n%s\\n' '--- systemd 定时器 ---'
  if ! systemctl list-timers --all --no-pager; then
    printf '%s\\n' '定时器查询失败，请核查 systemd 状态、权限及前面的错误。'
  fi
fi`,
    "基础路径只需 ls/sh，并展开 systemd 的 wants/requires 目录。仅在 systemctl 存在且有 /run/systemd/system 时补查启用服务与定时器；目录内容不等于运行状态，也不覆盖用户级单元和全部持久化机制。",
    "普通用户；受限配置需要 root",
  ),
  linux(
    "startup-scripts",
    "persistence",
    "查看启动脚本与登录配置",
    "读取 rc.local、profile.d、环境配置及当前用户的常见 Shell 启动文件。",
    `FOUND_CONFIG=0
for CONFIG_FILE in /etc/rc.local /etc/rc.d/rc.local /etc/profile /etc/profile.d/* /etc/environment /etc/bash.bashrc "\${HOME:-/root}/.profile" "\${HOME:-/root}/.bash_profile" "\${HOME:-/root}/.bashrc"; do
  if [ -f "$CONFIG_FILE" ]; then
    FOUND_CONFIG=1
    printf '\\n--- %s ---\\n' "$CONFIG_FILE"
    if [ -r "$CONFIG_FILE" ]; then
      cat "$CONFIG_FILE"
    else
      printf '%s\\n' '文件存在但不可读，请核查权限。'
    fi
  fi
done
if [ "$FOUND_CONFIG" -eq 0 ]; then printf '%s\\n' '未在这些路径发现启动脚本；请核查实际使用的 Shell 和 init 配置。'; fi`,
    "只读取文件，不使用 source 或执行其中内容。用户配置仅覆盖当前 HOME；不同 Shell、其他账号和 systemd 定时器需另行核查。",
    "普通用户；其他用户的配置可能需要 root",
  ),
  linux(
    "user-crontab",
    "persistence",
    "查看指定用户 crontab",
    "查看当前账号的周期任务；可将账号变量改为需要核查的用户。",
    `ACCOUNT_NAME=$(id -un) # 可替换为 root 等账号
if command -v crontab >/dev/null 2>&1; then
  if [ "$ACCOUNT_NAME" = "$(id -un)" ]; then
    crontab -l || printf '%s\\n' '未读取到 crontab；可能未配置、没有权限或 cron 不可用，请核对提示。'
  else
    crontab -u "$ACCOUNT_NAME" -l || printf '%s\\n' '未读取到该账号 crontab；请核对权限及前面的错误。'
  fi
else
  FOUND_CRON=0
  for CRON_FILE in "/var/spool/cron/crontabs/$ACCOUNT_NAME" "/var/spool/cron/$ACCOUNT_NAME"; do
    if [ -f "$CRON_FILE" ]; then
      FOUND_CRON=1
      printf '\\n--- %s ---\\n' "$CRON_FILE"
      if [ -r "$CRON_FILE" ]; then cat "$CRON_FILE"; else printf '%s\\n' '文件不可读，请核查权限。'; fi
    fi
  done
  if [ "$FOUND_CRON" -eq 0 ]; then printf '%s\\n' '没有 crontab 工具，也未在常见 spool 路径发现该账号配置；不能据此排除定时任务。'; fi
fi`,
    "优先使用 BusyBox crontab；无工具时读取常见 spool 文件。查看其他账号通常需要 root，不依赖 sudo。",
    "当前账号可查看自身配置；其他账号通常需要 root",
  ),
  linux(
    "system-cron",
    "persistence",
    "查看系统 cron 配置",
    "读取存在的系统 crontab/cron.d 文件，并列出周期脚本目录。",
    `FOUND_CONFIG=0
for CRON_FILE in /etc/crontab /etc/cron.d/*; do
  if [ -f "$CRON_FILE" ]; then
    FOUND_CONFIG=1
    printf '\\n--- %s ---\\n' "$CRON_FILE"
    if [ -r "$CRON_FILE" ]; then cat "$CRON_FILE"; else printf '%s\\n' '文件不可读，请核查权限。'; fi
  fi
done
for CRON_DIR in /etc/cron.hourly /etc/cron.daily /etc/cron.weekly /etc/cron.monthly /etc/periodic/*; do
  if [ -d "$CRON_DIR" ]; then
    FOUND_CONFIG=1
    printf '\\n--- %s ---\\n' "$CRON_DIR"
    ls -la "$CRON_DIR"
  fi
done
if [ "$FOUND_CONFIG" -eq 0 ]; then
  printf '%s\\n' '未发现这些常见 cron 配置路径，不能据此排除系统存在定时任务。'
fi`,
    "使用 sh 文件匹配、cat 和 ls；兼顾常见发行版与 Alpine/BusyBox 的 /etc/periodic，不使用 find -maxdepth/-exec，不运行周期脚本。",
    "普通用户；受限配置需要 root",
  ),
  linux(
    "login-success",
    "logs",
    "查看成功登录历史",
    "在提供 last 的系统上查看最近保存的登录和重启记录。",
    `if command -v last >/dev/null 2>&1; then
  if [ -r /var/log/wtmp ]; then
    last | head -n 50
  else
    printf '%s\\n' '没有可读的 /var/log/wtmp；请核对日志路径、读取权限和实际登录留存方式。'
  fi
else
  printf '%s\\n' '没有 last，无法解码 wtmp；请查看认证文本日志或导出日志离线分析。'
fi`,
    "不使用 last -Fai 等版本相关参数；兼容常见 BusyBox last。依赖 wtmp 等实际留存记录，精简系统/容器可能没有；输出前 50 行。",
    "普通用户",
  ),
  linux(
    "login-failure",
    "logs",
    "查看失败认证记录",
    "在常见文本日志中查看失败登录和无效账号线索。",
    `FOUND_LOG=0
for LOG_FILE in /var/log/auth.log /var/log/secure /var/log/messages /var/log/syslog; do
  if [ -f "$LOG_FILE" ]; then
    FOUND_LOG=1
    printf '\\n--- %s ---\\n' "$LOG_FILE"
    if [ -r "$LOG_FILE" ]; then
      grep -E 'Failed password|Failed publickey|Invalid user|authentication failure|Login attempt|Bad password' "$LOG_FILE" | tail -n 100
    else
      printf '%s\\n' '日志存在但不可读，请核查权限。'
    fi
  fi
done
if [ "$FOUND_LOG" -eq 0 ]; then
  printf '%s\\n' '未发现常见认证文本日志；请核查 syslog/logread 配置及实际日志路径。'
fi
if command -v lastb >/dev/null 2>&1 && [ -r /var/log/btmp ]; then
  printf '\\n%s\\n' '--- btmp 失败登录历史（lastb）---'
  lastb | head -n 100
fi`,
    "基础路径只需 BusyBox grep/tail；若 lastb 存在且 /var/log/btmp 可读，另补充前 100 行失败登录历史，不把二进制 btmp 当文本读取。文本匹配和日志留存均可能不完整，压缩/轮转日志需另查。",
    "root 或具有认证日志读取权限",
  ),
  linux(
    "ssh-auth",
    "logs",
    "查看 SSH 认证日志",
    "在存在的常见日志文件中筛查 sshd/dropbear 记录，缺失时尝试 journal。",
    `FOUND_LOG=0
for LOG_FILE in /var/log/auth.log /var/log/secure /var/log/messages /var/log/syslog; do
  if [ -f "$LOG_FILE" ]; then
    FOUND_LOG=1
    printf '\\n--- %s ---\\n' "$LOG_FILE"
    if [ -r "$LOG_FILE" ]; then
      grep -E '(sshd|dropbear)' "$LOG_FILE" | tail -n 100
    else
      printf '%s\\n' '日志存在但不可读，请核查权限。'
    fi
  fi
done
if [ "$FOUND_LOG" -eq 0 ]; then
  if command -v journalctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    journalctl -t sshd -n 100 --no-pager
  else
    printf '%s\\n' '未发现常见认证文本日志，且无可用 journal；请核查日志配置、路径和留存。'
  fi
fi`,
    "主要使用 BusyBox grep -E/tail，不假设 Debian 或 RHEL 路径一定存在；每文件只显示末 100 行匹配项，轮转/压缩日志和其他 SSH 实现需另查。",
    "root 或具有认证日志读取权限",
  ),
  linux(
    "system-logs",
    "logs",
    "查看最近系统日志",
    "读取常见系统日志末 100 行，缺失时尝试 BusyBox 内存日志。",
    `FOUND_LOG=0
for LOG_FILE in /var/log/messages /var/log/syslog /var/log/kern.log; do
  if [ -f "$LOG_FILE" ]; then
    FOUND_LOG=1
    printf '\\n--- %s ---\\n' "$LOG_FILE"
    if [ -r "$LOG_FILE" ]; then tail -n 100 "$LOG_FILE"; else printf '%s\\n' '日志存在但不可读，请核查权限。'; fi
  fi
done
if [ "$FOUND_LOG" -eq 0 ]; then
  if command -v logread >/dev/null 2>&1; then
    if LOG_OUTPUT=$(logread); then
      printf '%s\\n' "$LOG_OUTPUT" | tail -n 100
    else
      printf '%s\\n' 'logread 未能读取内存日志，请核查 syslogd、日志配置和权限。'
    fi
  elif command -v journalctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    journalctl -n 100 --no-pager
  else
    printf '%s\\n' '未发现常见系统日志，也无可用 logread/journal；请核查日志配置、路径及留存。'
  fi
fi`,
    "主要使用 BusyBox tail/logread，不预填固定日期。logread 需配置并运行相应 syslogd；journal 仅作为已运行 systemd 系统的可选回退，不自动安装或启动服务。",
    "普通用户；受限日志需要 root",
  ),
  linux(
    "hash",
    "files",
    "计算文件 SHA256",
    "使用 sha256sum 计算文件摘要，核对证据完整性。",
    `TARGET_PATH='/etc/passwd' # 示例文件，替换为目标文件的绝对路径
if [ -r "$TARGET_PATH" ]; then
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$TARGET_PATH"
  else
    printf '%s\\n' '当前工具集未提供 sha256sum，无法计算 SHA256；不要用 cksum/MD5 代替并标为 SHA256。'
  fi
else
  printf '%s\\n' '目标文件不存在或不可读，请替换路径并检查权限。'
fi`,
    "sha256sum 是常见 BusyBox applet，但可在构建时被裁剪。先替换绝对路径；哈希本身不能判断文件是否恶意。",
    "对目标文件有读取权限",
  ),
  linux(
    "file-stat",
    "files",
    "查看文件时间与权限",
    "查看文件属性；缺少 stat 时回退到数值 UID/GID 与 inode 列表。",
    `TARGET_PATH='/etc/passwd' # 示例文件，替换为目标文件的绝对路径
if command -v stat >/dev/null 2>&1; then
  stat "$TARGET_PATH"
else
  ls -ldin "$TARGET_PATH"
fi`,
    "使用 BusyBox stat 默认输出，不依赖 GNU 格式模板；ls 回退不能提供完整时间字段。ctime 是元数据变更时间，不是创建时间。",
    "对目标路径有访问权限",
  ),
  linux(
    "recent-files",
    "files",
    "查找近期修改文件",
    "在指定目录内查找最近 24 小时修改的普通文件，不跨文件系统。",
    `SEARCH_ROOT='/tmp' # 示例目录，替换为要检查的绝对路径
if [ -d "$SEARCH_ROOT" ]; then
  find "$SEARCH_ROOT" -xdev -type f -mtime -1 -print
else
  printf '%s\\n' '搜索目录不存在，请替换 SEARCH_ROOT。'
fi`,
    "使用常见 BusyBox find 支持的选项，不使用 GNU -printf；只输出路径。大目录可能耗时，文件名可含换行，文件时间也可能被修改。",
    "对目标目录有读取权限；其他目录可能需要 root",
  ),
  linux(
    "copy-logs",
    "files",
    "复制日志留存",
    "在全新取证目录中复制指定日志，尽量保留时间与权限。",
    `SOURCE_LOG='/var/log/auth.log' # 替换为存在且可读的源日志
EVIDENCE_DIR="./evidence-$(date +%Y%m%d-%H%M%S)" # 替换为新的输出目录
if [ ! -f "$SOURCE_LOG" ] || [ ! -r "$SOURCE_LOG" ]; then
  printf '%s\\n' '源日志不存在或不可读，请先替换 SOURCE_LOG 并核查权限。'
elif mkdir -m 700 "$EVIDENCE_DIR"; then
  if cp -p "$SOURCE_LOG" "$EVIDENCE_DIR/"; then
    printf '日志已复制到 %s/\\n' "$EVIDENCE_DIR"
  else
    printf '%s\\n' '复制失败或属性未能完整保留；请核查前面的错误和目标文件，不要将其作为已完成的证据副本。'
  fi
else
  printf '%s\\n' '未能创建全新取证目录，已停止复制；请核查目录是否已存在及写入权限。'
fi`,
    "使用 BusyBox mkdir/cp/date，不依赖 cp --no-clobber 或 sudo。mkdir 不带 -p，目录已存在时停止，因此不覆盖已有文件；cp -p 能否保留所有属性受权限影响，活动日志复制期间仍可能变化。",
    "源日志读取及目标目录写入权限；保留他人所有权通常需要 root",
  ),
];
