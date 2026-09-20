# 使用 Docker Compose 部署 Codexly

本文适用于希望通过已发布镜像运行 Codexly 的用户。部署会持久化 Codex 登录信息、配置和 Codexly 数据，并可限制项目选择器能够访问的宿主目录。

## 准备环境

安装 Docker Engine 24+ 和 Docker Compose v2，并确认以下命令可用：

```bash
docker version
docker compose version
```

Docker Desktop 用户需要先在设置中共享准备挂载的宿主目录。

## 下载部署文件

```bash
mkdir codexly
cd codexly
curl -fsSLO https://raw.githubusercontent.com/BryanHoo/Codexly/main/compose.yaml
curl -fsSLo .env.example https://raw.githubusercontent.com/BryanHoo/Codexly/main/.env.example
cp .env.example .env
```

编辑 `.env`。默认配置使用 `latest` 镜像、监听宿主 `127.0.0.1:3210`，并把宿主根目录挂载到容器 `/workspace`。显式设置 `CODEXLY_WORKSPACE` 后，Compose 会在容器内保留该绝对路径。

生产环境建议至少限制工作区：

```dotenv
CODEXLY_VERSION=0.23.0
CODEXLY_PORT=3210
CODEXLY_WORKSPACE=/srv/projects
```

项目选择器只能添加 `CODEXLY_WORKSPACE` 之内的真实目录。符号链接解析后如果越过该目录，也会被拒绝。

## 启动与配对

```bash
docker compose pull
docker compose up --detach
docker compose ps
docker compose logs --tail=50 codexly
```

状态变为 `healthy` 后打开 `http://127.0.0.1:3210`，输入日志中的随机配对码。也可以通过 `CODEXLY_LAN_PASSWORD` 设置固定密码，密码必须为 16 至 128 位并同时包含大小写字母和数字。

## 配置存储目录

默认的 `codexly-data` 命名卷挂载到容器 `/home/node/.codex`，保存以下数据：

- Codex 登录凭据和 `config.toml`
- Codexly SQLite 状态
- 会话历史及其他 Codex Home 数据

查看卷：

```bash
docker volume inspect codexly_codexly-data
```

需要复用宿主 Codex Home 时设置绝对路径，并把工作区设置为已有项目的公共父目录：

```dotenv
CODEXLY_CODEX_HOME=/home/example/.codex
CODEXLY_WORKSPACE=/home/example/projects
```

宿主目录必须允许容器内 `node` 用户读写。工作区在宿主和容器内使用相同绝对路径，因此 Codex Home 中已有的项目记录仍然有效。不要让两个 Codexly 实例同时使用同一个 Codex Home。

## 配置 Git 身份

容器不会自动读取宿主的全局 Git 配置。将配置文件放在容器可见的工作区内，并设置其容器绝对路径：

```dotenv
CODEXLY_WORKSPACE=/home/example
CODEXLY_GIT_CONFIG=/home/example/.gitconfig
CODEXLY_SSH_HOME=/home/example/.ssh
```

Linux 和 macOS 的同路径工作区可直接复用宿主 `~/.gitconfig`。使用 SSH 远程时，`CODEXLY_SSH_HOME` 会把宿主 SSH 配置、私钥和 `known_hosts` 只读挂载到容器。Windows 使用 `CODEXLY_WORKSPACE_TARGET` 映射后的 POSIX 路径。

## 配置工作区

不设置 `CODEXLY_WORKSPACE` 时，Compose 把宿主 `/` 挂载到容器 `/workspace`，因此 Linux 上可选择根目录下的磁盘和项目。设置后，源路径和容器路径保持一致。Docker Desktop 仍只能访问已经共享给 Docker 的目录。

限制为单个项目目录：

```dotenv
CODEXLY_WORKSPACE=/home/example/projects
```

Windows Docker Desktop 使用正斜杠路径，例如：

```dotenv
CODEXLY_WORKSPACE=C:/Users/example/projects
CODEXLY_WORKSPACE_TARGET=/workspace
```

Windows 宿主路径与 Linux 容器路径格式不同，因此不能直接复用包含宿主项目记录的 Codex Home。

需要暴露多个不相邻目录时，编辑 `compose.yaml`，为每个目录增加 bind mount，并在 `command` 中重复声明允许的容器目录：

```yaml
services:
  codexly:
    command:
      - start
      - --lan
      - --workspace
      - /workspaces/team-a
      - --workspace
      - /workspaces/team-b
    volumes:
      - codexly-data:/home/node/.codex
      - /srv/team-a:/workspaces/team-a
      - /data/team-b:/workspaces/team-b
```

## 自定义启动参数

镜像入口是 `codexly` CLI，可通过 Compose 的 `command` 传入全部 `start` 参数。例如配置反向代理域名：

```yaml
services:
  codexly:
    command: ["start", "--lan", "--allowed-host", "codexly.example.com"]
```

常用环境变量如下：

| 变量                       | 默认值                  | 用途                                          |
| -------------------------- | ----------------------- | --------------------------------------------- |
| `CODEXLY_VERSION`          | `latest`                | GHCR 镜像标签                                 |
| `CODEXLY_PORT`             | `3210`                  | 宿主和容器监听端口                            |
| `CODEXLY_WORKSPACE`        | `/`                     | 限制工作区并在容器内保留相同绝对路径          |
| `CODEXLY_WORKSPACE_TARGET` | 自动选择                | 覆盖容器工作区路径，Windows 使用 `/workspace` |
| `CODEXLY_GIT_CONFIG`       | `/home/node/.gitconfig` | 容器可见的全局 Git 配置文件                   |
| `CODEXLY_SSH_HOME`         | `codexly-ssh`           | 只读挂载宿主 SSH 配置、私钥和 `known_hosts`   |
| `CODEXLY_CODEX_HOME`       | `codexly-data`          | Codex Home 的命名卷或宿主绝对路径             |
| `CODEXLY_LAN_PASSWORD`     | 随机生成                | 固定配对密码                                  |
| `CODEXLY_SESSION_TTL`      | 当前进程有效            | 会话期限，例如 `12h`                          |
| `CODEXLY_ALLOWED_HOSTS`    | 空                      | 反向代理允许的精确域名，多个值用逗号分隔      |

## 更新与回退

更新到 `.env` 指定的镜像版本：

```bash
docker compose pull
docker compose up --detach
docker image prune
```

回退时把 `CODEXLY_VERSION` 改为已发布版本号，再重复前两条命令。命名卷不会因容器替换而删除。

## 备份与删除

使用宿主 Codex Home 时，直接备份 `CODEXLY_CODEX_HOME` 对应目录。使用默认命名卷时可导出：

```bash
docker run --rm \
  --volume codexly_codexly-data:/source:ro \
  --volume "$PWD":/backup \
  alpine tar -czf /backup/codexly-data.tar.gz -C /source .
```

停止服务但保留数据：

```bash
docker compose down
```

只有确定不再需要登录信息和历史数据时才删除命名卷：

```bash
docker compose down --volumes
```

## 排查问题

```bash
docker compose ps
docker compose logs --tail=200 codexly
docker inspect --format '{{json .State.Health}}' "$(docker compose ps --quiet codexly)"
```

如果项目目录不可见，检查宿主路径是否存在、Docker Desktop 是否共享该路径，以及 `CODEXLY_WORKSPACE` 是否为绝对路径。端口冲突时修改 `CODEXLY_PORT` 后重新创建容器。
