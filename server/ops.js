/**
 * 运维操作目录（对标 kejilion.sh 功能菜单）
 * 每个操作: id / name / desc / params / danger / build(params) -> shell 命令
 * - 所有用户输入统一 shell 转义，防止命令注入
 * - 命令自动适配 apt / dnf / yum / apk / pacman 等包管理器
 */

/** 单引号转义，任何输入都当作字面量 */
function q(s) {
  return "'" + String(s == null ? '' : s).replace(/'/g, "'\\''") + "'";
}

/** 校验端口号 */
function port(p) {
  const n = parseInt(p, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error('端口号无效（1-65535）');
  return String(n);
}

/** 校验正整数 */
function posInt(v, name) {
  const n = parseInt(v, 10);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name}必须为正整数`);
  return String(n);
}

// 包管理器探测（拼接在需要的命令前）
const PM_DETECT = `PM=""; if command -v apt-get >/dev/null 2>&1; then PM=apt; elif command -v dnf >/dev/null 2>&1; then PM=dnf; elif command -v yum >/dev/null 2>&1; then PM=yum; elif command -v apk >/dev/null 2>&1; then PM=apk; elif command -v pacman >/dev/null 2>&1; then PM=pacman; fi; `;

// 防火墙工具探测
const FW_DETECT = `FW=""; if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q active; then FW=ufw; elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then FW=firewalld; elif command -v iptables >/dev/null 2>&1; then FW=iptables; fi; `;

const CATEGORIES = [
  { id: 'assets', name: '资产与多机', icon: 'server' },
  { id: 'web', name: '网站与证书', icon: 'layout' },
  { id: 'database', name: '数据库', icon: 'database' },
  { id: 'automation', name: '任务编排', icon: 'clock' },
  { id: 'backup', name: '备份与恢复', icon: 'archive' },
  { id: 'security', name: '安全与审计', icon: 'shield-check' },
  { id: 'maintain', name: '系统维护', icon: 'wrench' },
  { id: 'network', name: '网络与加速', icon: 'globe' },
  { id: 'docker', name: 'Docker 管理', icon: 'box' },
  { id: 'firewall', name: '防火墙与端口', icon: 'shield' },
  { id: 'system', name: '系统设置', icon: 'settings' },
  { id: 'inspect', name: '监控与诊断', icon: 'activity' },
];

const OPS = [
  // ============ 企业资产与巡检 ============
  {
    id: 'asset-fingerprint', category: 'assets', name: '资产指纹盘点',
    desc: '汇总主机身份、虚拟化、网络接口、磁盘、运行服务与容器，便于建立企业资产台账',
    params: [],
    build: () => `echo "===== 主机身份 ====="
hostnamectl 2>/dev/null || uname -a
echo; echo "===== 虚拟化 ====="
systemd-detect-virt 2>/dev/null || virt-what 2>/dev/null || echo "未知"
echo; echo "===== 网络接口 ====="
ip -brief address 2>/dev/null || ifconfig -a 2>/dev/null
echo; echo "===== 块设备 ====="
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS 2>/dev/null
echo; echo "===== 运行服务 ====="
systemctl list-units --type=service --state=running --no-pager 2>/dev/null | head -40
echo; echo "===== 容器 ====="
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || echo "未安装 Docker"`,
  },
  {
    id: 'failed-units', category: 'assets', name: '异常服务巡检',
    desc: '列出 systemd 失败单元、反复重启的容器和近期内核错误，形成故障入口',
    params: [],
    build: () => `echo "===== systemd 失败单元 ====="
systemctl --failed --no-pager 2>/dev/null || true
echo; echo "===== 异常容器 ====="
docker ps -a --filter status=exited --filter status=restarting --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' 2>/dev/null || true
echo; echo "===== 近期高优先级日志 ====="
journalctl -p 0..3 -n 30 --no-pager 2>/dev/null || dmesg --level=err,warn 2>/dev/null | tail -30`,
  },
  // ============ 网站与证书 ============
  {
    id: 'website-inventory', category: 'web', name: '站点配置盘点',
    desc: '发现 Nginx、Apache、Caddy 站点配置及监听域名，形成站点资产清单',
    params: [],
    build: () => `echo "===== Nginx 站点 ====="
grep -RhsE '^[[:space:]]*(server_name|listen)[[:space:]]' /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | sed 's/^[[:space:]]*//' || true
echo; echo "===== Apache 站点 ====="
grep -RhsE '^[[:space:]]*(ServerName|ServerAlias|Listen)[[:space:]]' /etc/apache2/sites-enabled /etc/httpd/conf.d 2>/dev/null | sed 's/^[[:space:]]*//' || true
echo; echo "===== Caddy 配置 ====="
grep -vE '^[[:space:]]*(#|$)' /etc/caddy/Caddyfile 2>/dev/null | head -80 || true`,
  },
  {
    id: 'ssl-inventory', category: 'web', name: 'SSL 证书巡检',
    desc: '扫描常见证书目录，输出证书主题、签发者与到期时间，提前发现过期风险',
    params: [],
    build: () => `find /etc/letsencrypt/live /www/server/panel/vhost/cert /etc/ssl -type f \( -name 'fullchain.pem' -o -name '*.crt' -o -name '*.cert' \) 2>/dev/null | head -100 | while read cert; do
  end=$(openssl x509 -in "$cert" -noout -enddate 2>/dev/null | cut -d= -f2-)
  subject=$(openssl x509 -in "$cert" -noout -subject 2>/dev/null | sed 's/^subject=//')
  [ -n "$end" ] && printf '%s | %s | %s\n' "$cert" "$end" "$subject"
done`,
  },
  // ============ 数据库 ============
  {
    id: 'database-inventory', category: 'database', name: '数据库实例发现',
    desc: '发现 MySQL/MariaDB、PostgreSQL、Redis、MongoDB 进程、端口与容器实例',
    params: [],
    build: () => `echo "===== 本机数据库服务 ====="
systemctl list-units --type=service --all --no-pager 2>/dev/null | grep -Ei 'mysql|mariadb|postgres|redis|mongo' || true
echo; echo "===== 数据库监听端口 ====="
ss -lntp 2>/dev/null | grep -E ':(3306|5432|6379|27017|1433)[[:space:]]' || true
echo; echo "===== 数据库容器 ====="
docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}' 2>/dev/null | grep -Ei 'mysql|maria|postgres|redis|mongo|clickhouse' || true`,
  },
  // ============ 任务编排 ============
  {
    id: 'automation-inventory', category: 'automation', name: '计划任务总览',
    desc: '统一查看用户 Crontab、系统 Cron 与 systemd Timers，补齐青龙式任务可见性',
    params: [],
    build: () => `echo "===== 当前用户 Crontab ====="
crontab -l 2>/dev/null || echo "无"
echo; echo "===== 系统 Cron ====="
find /etc/cron.d /etc/cron.daily /etc/cron.hourly -maxdepth 1 -type f -printf '%p\n' 2>/dev/null | sort
echo; echo "===== systemd Timers ====="
systemctl list-timers --all --no-pager 2>/dev/null | head -60`,
  },
  // ============ 备份与恢复 ============
  {
    id: 'backup-inventory', category: 'backup', name: '备份状态巡检',
    desc: '扫描常见备份目录、最近归档文件和挂载存储，检查备份新鲜度与剩余空间',
    params: [],
    build: () => `echo "===== 最近备份文件 ====="
find /backup /backups /www/backup /opt/backup /home/backup -type f \( -name '*.tar*' -o -name '*.sql*' -o -name '*.zip' -o -name '*.bak' \) -printf '%TY-%Tm-%Td %TH:%TM | %s bytes | %p\n' 2>/dev/null | sort -r | head -50
echo; echo "===== 挂载与容量 ====="
df -hT | grep -vE 'tmpfs|devtmpfs|overlay'`,
  },
  {
    id: 'config-snapshot', category: 'backup', name: '创建配置快照',
    desc: '将 SSH、Web、计划任务与防火墙配置打包到 /backup/haizhuopspanel，便于变更前回滚',
    params: [], danger: true,
    build: () => `set -e
DEST=/backup/haizhuopspanel; mkdir -p "$DEST"; TS=$(date +%Y%m%d-%H%M%S)
tar --ignore-failed-read -czf "$DEST/config-$TS.tar.gz" /etc/ssh /etc/nginx /etc/apache2 /etc/httpd /etc/caddy /etc/cron.d /var/spool/cron /etc/ufw /etc/firewalld 2>/dev/null
sha256sum "$DEST/config-$TS.tar.gz" | tee "$DEST/config-$TS.sha256"
echo "===== 配置快照已创建: $DEST/config-$TS.tar.gz ====="`,
  },
  // ============ 安全与审计 ============
  {
    id: 'security-baseline', category: 'security', name: '安全基线扫描',
    desc: '检查 SSH、口令、sudo、开放端口、防火墙、自动更新与失败登录等关键基线项',
    params: [],
    build: () => `echo "===== SSH 基线 ====="
sshd -T 2>/dev/null | grep -E '^(permitrootlogin|passwordauthentication|pubkeyauthentication|maxauthtries|allowusers|allowgroups) ' || true
echo; echo "===== UID 0 账户 ====="; awk -F: '$3==0{print $1":"$7}' /etc/passwd
echo; echo "===== Sudo 授权 ====="; grep -RhsE '^[^#].*(ALL|NOPASSWD)' /etc/sudoers /etc/sudoers.d 2>/dev/null | head -40
echo; echo "===== 防火墙 ====="; (ufw status verbose 2>/dev/null || firewall-cmd --list-all 2>/dev/null || iptables -S 2>/dev/null | head -40)
echo; echo "===== 对外监听 ====="; ss -lntup 2>/dev/null
echo; echo "===== 最近失败登录 ====="; lastb -n 20 2>/dev/null || grep -Ei 'failed password|authentication failure' /var/log/auth.log /var/log/secure 2>/dev/null | tail -20`,
  },
  {
    id: 'ssh-key-audit', category: 'security', name: 'SSH 密钥审计',
    desc: '汇总系统用户的 authorized_keys 数量、权限和密钥指纹，不输出私钥或完整公钥',
    params: [],
    build: () => `find /root /home -path '*/.ssh/authorized_keys' -type f 2>/dev/null | while read f; do
  owner=$(stat -c '%U:%G %a' "$f" 2>/dev/null)
  echo "===== $f | $owner ====="
  awk 'NF>=2 && $1 !~ /^#/ {print $1" "$2}' "$f" | while read type key; do printf '%s ' "$type"; printf '%s %s' "$type" "$key" | ssh-keygen -lf - 2>/dev/null | awk '{print $2" "$3}'; done
done`,
  },
  // ============ 系统维护 ============
  {
    id: 'sys-update', category: 'maintain', name: '系统更新',
    desc: '更新软件源并升级全部软件包（自动识别 apt/dnf/yum/apk/pacman）',
    params: [],
    build: () => PM_DETECT + `case "$PM" in
apt) export DEBIAN_FRONTEND=noninteractive; apt-get update -y && apt-get -o Dpkg::Options::="--force-confold" upgrade -y ;;
dnf) dnf -y update ;;
yum) yum -y update ;;
apk) apk update && apk upgrade ;;
pacman) pacman -Syu --noconfirm ;;
*) echo "未检测到受支持的包管理器"; exit 1 ;;
esac; echo; echo "===== 系统更新完成 ====="`,
  },
  {
    id: 'sys-clean', category: 'maintain', name: '系统清理',
    desc: '清理包缓存、孤立依赖、旧日志与 journal 日志，释放磁盘空间',
    params: [],
    build: () => PM_DETECT + `BEFORE=$(df -m / | awk 'NR==2{print $4}')
case "$PM" in
apt) apt-get autoremove --purge -y; apt-get clean -y; apt-get autoclean -y ;;
dnf) dnf autoremove -y; dnf clean all ;;
yum) yum autoremove -y; yum clean all ;;
apk) apk cache clean 2>/dev/null || true ;;
pacman) pacman -Sc --noconfirm; pacman -Rns $(pacman -Qtdq) --noconfirm 2>/dev/null || true ;;
esac
command -v journalctl >/dev/null 2>&1 && journalctl --rotate && journalctl --vacuum-time=1d --vacuum-size=100M
find /var/log -type f \\( -name "*.gz" -o -name "*.[0-9]" -o -name "*.old" \\) -delete 2>/dev/null
AFTER=$(df -m / | awk 'NR==2{print $4}')
echo; echo "===== 清理完成，释放约 $((AFTER-BEFORE)) MB ====="`,
  },
  {
    id: 'base-tools', category: 'maintain', name: '安装基础工具',
    desc: '一键安装常用运维工具：curl wget sudo unzip tar htop vim jq rsync',
    params: [],
    build: () => PM_DETECT + `PKGS="curl wget sudo unzip tar htop vim jq rsync"
case "$PM" in
apt) apt-get update -y && apt-get install -y $PKGS ;;
dnf) dnf install -y $PKGS ;;
yum) yum install -y $PKGS ;;
apk) apk add $PKGS ;;
pacman) pacman -S --noconfirm --needed $PKGS ;;
*) echo "未检测到受支持的包管理器"; exit 1 ;;
esac; echo; echo "===== 基础工具安装完成 ====="`,
  },
  {
    id: 'pkg-install', category: 'maintain', name: '安装指定软件',
    desc: '通过系统包管理器安装指定软件包',
    params: [{ key: 'pkg', label: '软件包名', placeholder: '例如 nginx', required: true }],
    build: (p) => {
      if (!/^[A-Za-z0-9@._+-]+( [A-Za-z0-9@._+-]+)*$/.test(p.pkg || '')) throw new Error('软件包名格式无效');
      return PM_DETECT + `case "$PM" in
apt) apt-get update -y && apt-get install -y ${p.pkg} ;;
dnf) dnf install -y ${p.pkg} ;;
yum) yum install -y ${p.pkg} ;;
apk) apk add ${p.pkg} ;;
pacman) pacman -S --noconfirm ${p.pkg} ;;
*) echo "未检测到受支持的包管理器"; exit 1 ;;
esac`;
    },
  },
  {
    id: 'pkg-remove', category: 'maintain', name: '卸载指定软件', danger: true,
    desc: '通过系统包管理器卸载指定软件包',
    params: [{ key: 'pkg', label: '软件包名', placeholder: '例如 nginx', required: true }],
    build: (p) => {
      if (!/^[A-Za-z0-9@._+-]+( [A-Za-z0-9@._+-]+)*$/.test(p.pkg || '')) throw new Error('软件包名格式无效');
      return PM_DETECT + `case "$PM" in
apt) apt-get remove --purge -y ${p.pkg} && apt-get autoremove -y ;;
dnf) dnf remove -y ${p.pkg} ;;
yum) yum remove -y ${p.pkg} ;;
apk) apk del ${p.pkg} ;;
pacman) pacman -Rns --noconfirm ${p.pkg} ;;
*) echo "未检测到受支持的包管理器"; exit 1 ;;
esac`;
    },
  },
  {
    id: 'sys-reboot', category: 'maintain', name: '重启服务器', danger: true,
    desc: '立即重启远程主机（连接会中断，请稍后重新连接）',
    params: [],
    build: () => `echo "服务器将在 3 秒后重启..."; sleep 3; reboot || systemctl reboot`,
  },

  // ============ 网络与加速 ============
  {
    id: 'bbr-status', category: 'network', name: 'BBR 状态查询',
    desc: '查看当前内核版本、TCP 拥塞控制算法与队列调度算法',
    params: [],
    build: () => `echo "内核版本: $(uname -r)"
echo "拥塞控制算法: $(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null)"
echo "可用算法:     $(sysctl -n net.ipv4.tcp_available_congestion_control 2>/dev/null)"
echo "队列调度:     $(sysctl -n net.core.default_qdisc 2>/dev/null)"`,
  },
  {
    id: 'bbr-enable', category: 'network', name: '开启 BBR 加速',
    desc: '启用 BBR 拥塞控制 + FQ 队列调度并持久化（需内核 ≥ 4.9）',
    params: [],
    build: () => `modprobe tcp_bbr 2>/dev/null
if ! sysctl -n net.ipv4.tcp_available_congestion_control | grep -qw bbr; then echo "当前内核不支持 BBR，请先升级内核 (>= 4.9)"; exit 1; fi
cat > /etc/sysctl.d/99-haizhuopspanel-bbr.conf <<EOF
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
EOF
sysctl --system >/dev/null 2>&1 || sysctl -p /etc/sysctl.d/99-haizhuopspanel-bbr.conf
echo "===== BBR 已开启 ====="
echo "拥塞控制算法: $(sysctl -n net.ipv4.tcp_congestion_control)"
echo "队列调度:     $(sysctl -n net.core.default_qdisc)"`,
  },
  {
    id: 'kernel-optimize', category: 'network', name: '内核参数优化',
    desc: '应用均衡模式网络/文件句柄内核调优（TCP FastOpen、连接队列、端口范围等）',
    params: [],
    build: () => `cat > /etc/sysctl.d/99-haizhuopspanel-tuning.conf <<EOF
fs.file-max = 1048576
net.core.somaxconn = 4096
net.core.netdev_max_backlog = 8192
net.ipv4.tcp_max_syn_backlog = 8192
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 30
net.ipv4.tcp_keepalive_time = 600
net.ipv4.ip_local_port_range = 10240 65535
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_mtu_probing = 1
vm.swappiness = 10
EOF
sysctl --system >/dev/null 2>&1 || sysctl -p /etc/sysctl.d/99-haizhuopspanel-tuning.conf
echo "===== 内核参数优化完成（/etc/sysctl.d/99-haizhuopspanel-tuning.conf）====="`,
  },
  {
    id: 'dns-view', category: 'network', name: '查看 DNS 配置',
    desc: '显示当前 /etc/resolv.conf 解析配置',
    params: [],
    build: () => `cat /etc/resolv.conf`,
  },
  {
    id: 'dns-set', category: 'network', name: '优化 DNS 地址',
    desc: '一键写入优选 DNS（海外: Cloudflare/Google，国内: 阿里/腾讯）',
    params: [{
      key: 'region', label: 'DNS 方案', type: 'select', required: true,
      options: [
        { value: 'global', label: '海外优化 (1.1.1.1 / 8.8.8.8)' },
        { value: 'cn', label: '国内优化 (223.5.5.5 / 119.29.29.29)' },
      ],
    }],
    build: (p) => {
      const dns = p.region === 'cn'
        ? 'nameserver 223.5.5.5\nnameserver 119.29.29.29'
        : 'nameserver 1.1.1.1\nnameserver 8.8.8.8';
      return `chattr -i /etc/resolv.conf 2>/dev/null
cat > /etc/resolv.conf <<EOF
${dns}
EOF
echo "===== DNS 已更新 ====="; cat /etc/resolv.conf
echo; echo "提示: 若系统使用 systemd-resolved/NetworkManager 托管 DNS，重启网络后可能被覆盖"`;
    },
  },
  {
    id: 'net-test', category: 'network', name: '网络连通性测试',
    desc: '对常见节点进行延迟测试并查询公网出口 IP',
    params: [],
    build: () => `echo "===== 公网出口 IP ====="
curl -s --max-time 5 https://ipinfo.io/ip || curl -s --max-time 5 ifconfig.me || echo "查询失败"
echo; echo "===== 延迟测试 ====="
for t in 1.1.1.1 8.8.8.8 223.5.5.5; do
  r=$(ping -c 3 -W 2 $t 2>/dev/null | tail -1 | awk -F'/' '{print $5}')
  [ -n "$r" ] && echo "$t  平均延迟 $r ms" || echo "$t  超时"
done`,
  },
  {
    id: 'port-check', category: 'network', name: '端口连通性检测',
    desc: '从远程主机检测目标地址端口是否可达',
    params: [
      { key: 'target', label: '目标地址', placeholder: '例如 example.com', required: true },
      { key: 'port', label: '端口', placeholder: '例如 443', required: true },
    ],
    build: (p) => {
      if (!/^[A-Za-z0-9.:-]+$/.test(p.target || '')) throw new Error('目标地址格式无效');
      return `timeout 5 bash -c "cat < /dev/null > /dev/tcp/${p.target}/${port(p.port)}" 2>/dev/null && echo "✔ ${p.target}:${port(p.port)} 可达" || echo "✘ ${p.target}:${port(p.port)} 不可达"`;
    },
  },

  // ============ Docker 管理 ============
  {
    id: 'docker-install', category: 'docker', name: '安装 / 更新 Docker',
    desc: '使用官方脚本 get.docker.com 安装或更新 Docker 并设置开机自启',
    params: [],
    build: () => `curl -fsSL https://get.docker.com | sh && (systemctl enable --now docker 2>/dev/null || service docker start) && echo && docker --version && echo "===== Docker 安装完成 ====="`,
  },
  {
    id: 'docker-overview', category: 'docker', name: 'Docker 全局状态',
    desc: '查看 Docker 版本、镜像 / 容器 / 网络 / 卷概览',
    params: [],
    build: () => `command -v docker >/dev/null 2>&1 || { echo "未安装 Docker"; exit 1; }
docker version --format 'Docker 版本: {{.Server.Version}}' 2>/dev/null || docker --version
echo "-----------------------------"
echo "容器: $(docker ps -a -q 2>/dev/null | wc -l) 个（运行中 $(docker ps -q | wc -l)）"
echo "镜像: $(docker images -q 2>/dev/null | wc -l) 个"
echo "网络: $(docker network ls -q 2>/dev/null | wc -l) 个"
echo "卷:   $(docker volume ls -q 2>/dev/null | wc -l) 个"
echo "-----------------------------"
docker ps -a --format "table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}"`,
  },
  {
    id: 'docker-ps', category: 'docker', name: '容器列表',
    desc: '列出全部容器（含已停止）',
    params: [],
    build: () => `docker ps -a --format "table {{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}"`,
  },
  {
    id: 'docker-images', category: 'docker', name: '镜像列表',
    desc: '列出本地全部镜像',
    params: [],
    build: () => `docker images --format "table {{.Repository}}\\t{{.Tag}}\\t{{.ID}}\\t{{.Size}}\\t{{.CreatedSince}}"`,
  },
  {
    id: 'docker-stats', category: 'docker', name: '容器资源占用',
    desc: '查看各容器 CPU / 内存 / 网络 / IO 占用快照',
    params: [],
    build: () => `docker stats --no-stream --format "table {{.Name}}\\t{{.CPUPerc}}\\t{{.MemUsage}}\\t{{.NetIO}}\\t{{.BlockIO}}"`,
  },
  {
    id: 'docker-ctl', category: 'docker', name: '容器启停控制',
    desc: '对指定容器执行启动 / 停止 / 重启操作',
    params: [
      { key: 'name', label: '容器名或ID', placeholder: '例如 nginx', required: true },
      {
        key: 'action', label: '操作', type: 'select', required: true,
        options: [
          { value: 'start', label: '启动' },
          { value: 'stop', label: '停止' },
          { value: 'restart', label: '重启' },
        ],
      },
    ],
    build: (p) => {
      if (!['start', 'stop', 'restart'].includes(p.action)) throw new Error('操作无效');
      return `docker ${p.action} ${q(p.name)} && echo "===== 已${p.action === 'start' ? '启动' : p.action === 'stop' ? '停止' : '重启'} ${String(p.name)} ====="`;
    },
  },
  {
    id: 'docker-ctl-all', category: 'docker', name: '全部容器启停', danger: true,
    desc: '批量启动 / 停止 / 重启所有容器',
    params: [{
      key: 'action', label: '操作', type: 'select', required: true,
      options: [
        { value: 'start', label: '启动全部' },
        { value: 'stop', label: '停止全部' },
        { value: 'restart', label: '重启全部' },
      ],
    }],
    build: (p) => {
      if (!['start', 'stop', 'restart'].includes(p.action)) throw new Error('操作无效');
      const list = p.action === 'start' ? 'docker ps -a -q' : 'docker ps -q';
      return `IDS=$(${list}); [ -z "$IDS" ] && { echo "没有可操作的容器"; exit 0; }; docker ${p.action} $IDS && echo "===== 操作完成 ====="`;
    },
  },
  {
    id: 'docker-logs', category: 'docker', name: '查看容器日志',
    desc: '查看指定容器最近 200 行日志',
    params: [{ key: 'name', label: '容器名或ID', placeholder: '例如 nginx', required: true }],
    build: (p) => `docker logs --tail 200 ${q(p.name)}`,
  },
  {
    id: 'docker-rm', category: 'docker', name: '删除指定容器', danger: true,
    desc: '强制删除指定容器（数据卷保留）',
    params: [{ key: 'name', label: '容器名或ID', placeholder: '例如 nginx', required: true }],
    build: (p) => `docker rm -f ${q(p.name)} && echo "===== 容器已删除 ====="`,
  },
  {
    id: 'docker-rmi', category: 'docker', name: '删除指定镜像', danger: true,
    desc: '删除指定镜像（镜像名:标签 或 镜像ID）',
    params: [{ key: 'image', label: '镜像名:标签', placeholder: '例如 nginx:latest', required: true }],
    build: (p) => `docker rmi ${q(p.image)} && echo "===== 镜像已删除 ====="`,
  },
  {
    id: 'docker-prune', category: 'docker', name: '清理未用资源', danger: true,
    desc: '清理已停止容器、无用网络、悬空镜像与构建缓存（docker system prune）',
    params: [],
    build: () => `docker system prune -f && echo "===== Docker 清理完成 ====="`,
  },
  {
    id: 'docker-net', category: 'docker', name: '容器网络信息',
    desc: '查看 Docker 网络及各容器 IP 分配',
    params: [],
    build: () => `docker network ls
echo "-----------------------------"
for net in $(docker network ls --format '{{.Name}}'); do
  echo "网络: $net"
  docker network inspect "$net" --format '{{range .Containers}}  {{.Name}}: {{.IPv4Address}}{{println}}{{end}}' 2>/dev/null
done`,
  },

  // ============ 防火墙与端口 ============
  {
    id: 'port-usage', category: 'firewall', name: '端口占用状态',
    desc: '查看当前监听端口及对应进程（ss -tulnp）',
    params: [],
    build: () => `ss -tulnp 2>/dev/null || netstat -tulnp`,
  },
  {
    id: 'fw-status', category: 'firewall', name: '防火墙状态',
    desc: '自动识别 ufw / firewalld / iptables 并显示当前规则',
    params: [],
    build: () => FW_DETECT + `case "$FW" in
ufw) echo "[ufw]"; ufw status verbose ;;
firewalld) echo "[firewalld]"; firewall-cmd --list-all ;;
iptables) echo "[iptables]"; iptables -L -n --line-numbers ;;
*) echo "未检测到防火墙工具" ;;
esac`,
  },
  {
    id: 'port-open', category: 'firewall', name: '开放指定端口',
    desc: '在防火墙上放行指定端口（自动识别 ufw / firewalld / iptables）',
    params: [
      { key: 'port', label: '端口号', placeholder: '例如 8080', required: true },
      {
        key: 'proto', label: '协议', type: 'select', required: true,
        options: [{ value: 'tcp', label: 'TCP' }, { value: 'udp', label: 'UDP' }],
      },
    ],
    build: (p) => {
      const pt = port(p.port);
      const proto = p.proto === 'udp' ? 'udp' : 'tcp';
      return FW_DETECT + `case "$FW" in
ufw) ufw allow ${pt}/${proto} ;;
firewalld) firewall-cmd --permanent --add-port=${pt}/${proto} && firewall-cmd --reload ;;
iptables) iptables -I INPUT -p ${proto} --dport ${pt} -j ACCEPT; command -v netfilter-persistent >/dev/null 2>&1 && netfilter-persistent save; command -v service >/dev/null 2>&1 && service iptables save 2>/dev/null ;;
*) echo "未检测到防火墙工具"; exit 1 ;;
esac; echo "===== 端口 ${pt}/${proto} 已开放 ====="`;
    },
  },
  {
    id: 'port-close', category: 'firewall', name: '关闭指定端口', danger: true,
    desc: '在防火墙上封禁指定端口（注意不要关闭当前 SSH 端口）',
    params: [
      { key: 'port', label: '端口号', placeholder: '例如 8080', required: true },
      {
        key: 'proto', label: '协议', type: 'select', required: true,
        options: [{ value: 'tcp', label: 'TCP' }, { value: 'udp', label: 'UDP' }],
      },
    ],
    build: (p) => {
      const pt = port(p.port);
      const proto = p.proto === 'udp' ? 'udp' : 'tcp';
      return FW_DETECT + `case "$FW" in
ufw) ufw deny ${pt}/${proto} ;;
firewalld) firewall-cmd --permanent --remove-port=${pt}/${proto}; firewall-cmd --permanent --add-rich-rule="rule port port=${pt} protocol=${proto} reject" && firewall-cmd --reload ;;
iptables) iptables -I INPUT -p ${proto} --dport ${pt} -j DROP; command -v netfilter-persistent >/dev/null 2>&1 && netfilter-persistent save ;;
*) echo "未检测到防火墙工具"; exit 1 ;;
esac; echo "===== 端口 ${pt}/${proto} 已关闭 ====="`;
    },
  },
  {
    id: 'ping-toggle', category: 'firewall', name: '允许 / 禁止 PING',
    desc: '控制主机是否响应 ICMP Ping 请求（持久化生效）',
    params: [{
      key: 'mode', label: '模式', type: 'select', required: true,
      options: [{ value: 'allow', label: '允许 PING' }, { value: 'deny', label: '禁止 PING' }],
    }],
    build: (p) => {
      const v = p.mode === 'deny' ? 1 : 0;
      return `cat > /etc/sysctl.d/99-haizhuopspanel-icmp.conf <<EOF
net.ipv4.icmp_echo_ignore_all = ${v}
EOF
sysctl --system >/dev/null 2>&1 || sysctl -p /etc/sysctl.d/99-haizhuopspanel-icmp.conf
echo "===== 已${v ? '禁止' : '允许'} PING ====="`;
    },
  },
  {
    id: 'fail2ban', category: 'firewall', name: 'SSH 防爆破 (fail2ban)',
    desc: '安装并启用 fail2ban，自动封禁 SSH 暴力破解 IP',
    params: [],
    build: () => PM_DETECT + `case "$PM" in
apt) apt-get update -y && apt-get install -y fail2ban ;;
dnf) dnf install -y epel-release 2>/dev/null; dnf install -y fail2ban ;;
yum) yum install -y epel-release 2>/dev/null; yum install -y fail2ban ;;
*) echo "当前系统请手动安装 fail2ban"; exit 1 ;;
esac
mkdir -p /etc/fail2ban
cat > /etc/fail2ban/jail.local <<EOF
[sshd]
enabled = true
maxretry = 5
findtime = 600
bantime = 3600
EOF
systemctl enable --now fail2ban && systemctl restart fail2ban
sleep 2; fail2ban-client status sshd 2>/dev/null || fail2ban-client status
echo "===== fail2ban 已启用 ====="`,
  },

  // ============ 系统设置 ============
  {
    id: 'hostname-set', category: 'system', name: '修改主机名',
    desc: '设置新主机名并同步更新 /etc/hosts',
    params: [{ key: 'hostname', label: '新主机名', placeholder: '例如 web-server-01', required: true }],
    build: (p) => {
      if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$/.test(p.hostname || '')) throw new Error('主机名格式无效');
      return `OLD=$(hostname)
hostnamectl set-hostname ${q(p.hostname)} 2>/dev/null || { echo ${q(p.hostname)} > /etc/hostname && hostname ${q(p.hostname)}; }
sed -i "s/$OLD/${p.hostname}/g" /etc/hosts 2>/dev/null
grep -q ${q(p.hostname)} /etc/hosts || echo "127.0.1.1 ${p.hostname}" >> /etc/hosts
echo "===== 主机名已修改: $OLD -> $(hostname) ====="`;
    },
  },
  {
    id: 'timezone-set', category: 'system', name: '系统时区调整',
    desc: '查看并设置系统时区',
    params: [{
      key: 'tz', label: '时区', type: 'select', required: true,
      options: [
        { value: 'Asia/Shanghai', label: '亚洲/上海 (UTC+8)' },
        { value: 'Asia/Hong_Kong', label: '亚洲/香港 (UTC+8)' },
        { value: 'Asia/Tokyo', label: '亚洲/东京 (UTC+9)' },
        { value: 'Asia/Singapore', label: '亚洲/新加坡 (UTC+8)' },
        { value: 'Europe/London', label: '欧洲/伦敦 (UTC+0)' },
        { value: 'Europe/Berlin', label: '欧洲/柏林 (UTC+1)' },
        { value: 'America/New_York', label: '美国/纽约 (UTC-5)' },
        { value: 'America/Los_Angeles', label: '美国/洛杉矶 (UTC-8)' },
        { value: 'UTC', label: 'UTC 标准时间' },
      ],
    }],
    build: (p) => {
      if (!/^[A-Za-z_]+(\/[A-Za-z_]+)?$/.test(p.tz || '')) throw new Error('时区格式无效');
      return `timedatectl set-timezone ${q(p.tz)} 2>/dev/null || { ln -sf /usr/share/zoneinfo/${p.tz} /etc/localtime && echo ${q(p.tz)} > /etc/timezone; }
echo "===== 时区已设置为 ${p.tz} ====="; date`;
    },
  },
  {
    id: 'swap-view', category: 'system', name: '查看虚拟内存',
    desc: '显示当前 Swap 使用情况',
    params: [],
    build: () => `free -h; echo "-----------------------------"; swapon --show 2>/dev/null || cat /proc/swaps`,
  },
  {
    id: 'swap-set', category: 'system', name: '调整虚拟内存', danger: true,
    desc: '重建 /swapfile 为指定大小（原 /swapfile 将被替换并写入 fstab）',
    params: [{ key: 'size', label: 'Swap 大小 (MB)', placeholder: '例如 1024', required: true }],
    build: (p) => {
      const size = posInt(p.size, 'Swap 大小');
      return `swapoff /swapfile 2>/dev/null; rm -f /swapfile
fallocate -l ${size}M /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=${size} status=none
chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
echo "===== Swap 已调整为 ${size} MB ====="; free -h`;
    },
  },
  {
    id: 'ssh-port', category: 'system', name: '修改 SSH 端口', danger: true,
    desc: '修改 sshd 监听端口并放行防火墙（修改后请用新端口重新添加主机连接）',
    params: [{ key: 'port', label: '新 SSH 端口', placeholder: '例如 2222', required: true }],
    build: (p) => {
      const pt = port(p.port);
      return `sed -ri 's/^#?[[:space:]]*Port[[:space:]]+[0-9]+/Port ${pt}/' /etc/ssh/sshd_config
grep -q '^Port ' /etc/ssh/sshd_config || echo 'Port ${pt}' >> /etc/ssh/sshd_config
` + FW_DETECT + `case "$FW" in
ufw) ufw allow ${pt}/tcp ;;
firewalld) firewall-cmd --permanent --add-port=${pt}/tcp && firewall-cmd --reload ;;
iptables) iptables -I INPUT -p tcp --dport ${pt} -j ACCEPT ;;
esac
command -v semanage >/dev/null 2>&1 && semanage port -a -t ssh_port_t -p tcp ${pt} 2>/dev/null
sshd -t && (systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || service sshd restart 2>/dev/null || service ssh restart)
echo "===== SSH 端口已修改为 ${pt}，请使用新端口重新连接 ====="`;
    },
  },
  {
    id: 'root-passwd', category: 'system', name: '修改 ROOT 密码', danger: true,
    desc: '重置远程主机 root 账户密码',
    params: [{ key: 'password', label: '新密码', type: 'password', placeholder: '至少 8 位', required: true }],
    build: (p) => {
      if (!p.password || p.password.length < 8) throw new Error('密码长度至少 8 位');
      return `echo root:${q(p.password)} | chpasswd && echo "===== root 密码已修改 ====="`;
    },
  },
  {
    id: 'user-list', category: 'system', name: '用户管理 · 列表',
    desc: '列出系统可登录用户及 sudo 权限',
    params: [],
    build: () => `printf "%-20s %-6s %-20s %s\\n" "用户名" "UID" "SHELL" "SUDO"
awk -F: '$7 !~ /(nologin|false)$/ {print $1" "$3" "$7}' /etc/passwd | while read u uid sh; do
  s="-"; groups "$u" 2>/dev/null | grep -Eq '\\b(sudo|wheel)\\b' && s="✔"
  printf "%-20s %-6s %-20s %s\\n" "$u" "$uid" "$sh" "$s"
done`,
  },
  {
    id: 'user-add', category: 'system', name: '用户管理 · 新建',
    desc: '创建普通用户并设置密码（可选加入 sudo 组）',
    params: [
      { key: 'username', label: '用户名', placeholder: '例如 devops', required: true },
      { key: 'password', label: '密码', type: 'password', placeholder: '至少 8 位', required: true },
      {
        key: 'sudo', label: 'sudo 权限', type: 'select', required: true,
        options: [{ value: 'no', label: '普通用户' }, { value: 'yes', label: '授予 sudo' }],
      },
    ],
    build: (p) => {
      if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(p.username || '')) throw new Error('用户名格式无效');
      if (!p.password || p.password.length < 8) throw new Error('密码长度至少 8 位');
      const sudoCmd = p.sudo === 'yes'
        ? `usermod -aG sudo ${p.username} 2>/dev/null || usermod -aG wheel ${p.username} 2>/dev/null`
        : 'true';
      return `useradd -m -s /bin/bash ${p.username} 2>/dev/null || adduser -D ${p.username}
echo ${q(p.username + ':' + p.password)} | chpasswd
${sudoCmd}
echo "===== 用户 ${p.username} 创建完成 ====="; id ${p.username}`;
    },
  },
  {
    id: 'user-del', category: 'system', name: '用户管理 · 删除', danger: true,
    desc: '删除指定用户及其主目录',
    params: [{ key: 'username', label: '用户名', placeholder: '要删除的用户', required: true }],
    build: (p) => {
      if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(p.username || '')) throw new Error('用户名格式无效');
      if (p.username === 'root') throw new Error('禁止删除 root 用户');
      return `userdel -r ${p.username} 2>/dev/null || deluser --remove-home ${p.username}
echo "===== 用户 ${p.username} 已删除 ====="`;
    },
  },
  {
    id: 'cron-list', category: 'system', name: '定时任务查看',
    desc: '查看 root 用户 crontab 及系统级定时任务',
    params: [],
    build: () => `echo "===== crontab (当前用户) ====="
crontab -l 2>/dev/null || echo "(无)"
echo; echo "===== /etc/cron.d ====="
ls -l /etc/cron.d 2>/dev/null || echo "(无)"
echo; echo "===== systemd timers ====="
systemctl list-timers --no-pager 2>/dev/null | head -20`,
  },

  // ============ 监控与诊断 ============
  {
    id: 'top-procs', category: 'inspect', name: '资源占用排行',
    desc: '查看 CPU 与内存占用最高的进程',
    params: [],
    build: () => `echo "===== CPU 占用 TOP 10 ====="
ps aux --sort=-%cpu 2>/dev/null | head -11 || ps aux | sort -rk3 | head -11
echo; echo "===== 内存占用 TOP 10 ====="
ps aux --sort=-%mem 2>/dev/null | head -11 || ps aux | sort -rk4 | head -11`,
  },
  {
    id: 'disk-usage', category: 'inspect', name: '磁盘空间分析',
    desc: '查看各分区使用率与根目录下最大的目录',
    params: [],
    build: () => `df -h | grep -vE 'tmpfs|overlay|udev|loop'
echo; echo "===== / 下占用最大的目录 TOP 10 ====="
du -xh --max-depth=2 / 2>/dev/null | sort -rh | head -10`,
  },
  {
    id: 'disk-io-test', category: 'inspect', name: '磁盘 IO 测速',
    desc: '使用 dd 进行简单顺序写入 / 读取测速（临时文件自动清理）',
    params: [],
    build: () => `echo "===== 顺序写入测试 (1GB) ====="
dd if=/dev/zero of=/tmp/haizhuopspanel_io_test bs=64k count=16k conv=fdatasync 2>&1 | tail -1
echo; echo "===== 顺序读取测试 ====="
dd if=/tmp/haizhuopspanel_io_test of=/dev/null bs=64k 2>&1 | tail -1
rm -f /tmp/haizhuopspanel_io_test`,
  },
  {
    id: 'login-history', category: 'inspect', name: '登录审计',
    desc: '查看最近登录记录与失败登录尝试',
    params: [],
    build: () => `echo "===== 最近登录 ====="
last -n 15 2>/dev/null || echo "(不支持)"
echo; echo "===== 失败登录 (最近15条) ====="
lastb -n 15 2>/dev/null || grep -i 'failed password' /var/log/auth.log 2>/dev/null | tail -15 || grep -i 'failed password' /var/log/secure 2>/dev/null | tail -15 || echo "(无记录或无权限)"`,
  },
  {
    id: 'service-status', category: 'inspect', name: '服务状态查询',
    desc: '查看指定 systemd 服务运行状态与最近日志',
    params: [{ key: 'service', label: '服务名', placeholder: '例如 nginx', required: true }],
    build: (p) => {
      if (!/^[A-Za-z0-9@._-]+$/.test(p.service || '')) throw new Error('服务名格式无效');
      return `systemctl status ${p.service} --no-pager -l 2>&1 | head -30
echo; echo "===== 最近日志 ====="
journalctl -u ${p.service} -n 20 --no-pager 2>/dev/null || echo "(无 journal 日志)"`;
    },
  },
  {
    id: 'service-ctl', category: 'inspect', name: '服务启停控制', danger: true,
    desc: '对指定 systemd 服务执行启动 / 停止 / 重启 / 开机自启操作',
    params: [
      { key: 'service', label: '服务名', placeholder: '例如 nginx', required: true },
      {
        key: 'action', label: '操作', type: 'select', required: true,
        options: [
          { value: 'start', label: '启动' },
          { value: 'stop', label: '停止' },
          { value: 'restart', label: '重启' },
          { value: 'enable', label: '开机自启' },
          { value: 'disable', label: '取消自启' },
        ],
      },
    ],
    build: (p) => {
      if (!/^[A-Za-z0-9@._-]+$/.test(p.service || '')) throw new Error('服务名格式无效');
      if (!['start', 'stop', 'restart', 'enable', 'disable'].includes(p.action)) throw new Error('操作无效');
      return `systemctl ${p.action} ${p.service} && echo "===== systemctl ${p.action} ${p.service} 完成 =====" && systemctl is-active ${p.service}`;
    },
  },
];

/** 系统信息仪表盘采集脚本（输出 KEY|VALUE 行，POSIX sh 兼容） */
const SYSINFO_SCRIPT = `
cpu_sample() { awk '/^cpu /{print $2+$3+$4+$6+$7+$8, $5}' /proc/stat; }
s1=$(cpu_sample); sleep 1; s2=$(cpu_sample)
b1=$(echo $s1 | cut -d' ' -f1); i1=$(echo $s1 | cut -d' ' -f2)
b2=$(echo $s2 | cut -d' ' -f1); i2=$(echo $s2 | cut -d' ' -f2)
db=$((b2-b1)); di=$((i2-i1)); tot=$((db+di))
[ "$tot" -gt 0 ] && CPU=$((db*100/tot)) || CPU=0
echo "HOSTNAME|$(hostname)"
echo "OS|$(grep -s '^PRETTY_NAME' /etc/os-release | cut -d= -f2- | tr -d '\\"')"
echo "KERNEL|$(uname -r)"
echo "ARCH|$(uname -m)"
echo "CPU_MODEL|$(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2- | sed 's/^ *//')"
echo "CPU_CORES|$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo)"
echo "CPU_USAGE|$CPU"
echo "LOAD|$(cut -d' ' -f1-3 /proc/loadavg)"
echo "MEM|$(free -m | awk '/^Mem:/{print $3"|"$2}')"
echo "SWAP|$(free -m | awk '/^Swap:/{print $3"|"$2}')"
echo "DISK|$(df -m / | awk 'NR==2{print $3"|"$2"|"$5}')"
echo "UPTIME|$(uptime -p 2>/dev/null || awk '{d=int($1/86400);h=int($1%86400/3600);m=int($1%3600/60); printf "up %dd %dh %dm", d, h, m}' /proc/uptime)"
echo "TCP_CC|$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null)"
echo "QDISC|$(sysctl -n net.core.default_qdisc 2>/dev/null)"
echo "TIME|$(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "IP_LOCAL|$(hostname -I 2>/dev/null | awk '{print $1}' || ip -4 addr show scope global 2>/dev/null | awk '/inet/{print $2; exit}')"
echo "IP_PUBLIC|$(curl -s --max-time 4 https://ipinfo.io/ip 2>/dev/null || echo 未知)"
echo "DOCKER|$(command -v docker >/dev/null 2>&1 && docker ps -q 2>/dev/null | wc -l || echo -1)"
`;

function getOp(id) {
  return OPS.find((o) => o.id === id) || null;
}

/** 前端目录：不含 build 函数 */
function catalog() {
  return {
    categories: CATEGORIES,
    ops: OPS.map(({ build, ...rest }) => rest),
  };
}

module.exports = { catalog, getOp, SYSINFO_SCRIPT, q };
