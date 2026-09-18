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

编辑 `.env`。默认配置使用 `latest` 镜像、监听宿主 `127.0.0.1:3210`，并把宿主根目录挂载到容器 `/workspace`。

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

状态变为 `healthy` 后打开 `http://127.0.0.1:3210`，输入日志中的随机配对码。也可以通过 `CODEXLY_LAN_PASSWORD` 设置固定密码，密码必须为 16 至 128 位并同时包含大小写字母、数字和符号。

## 配置存储目录

默认的 `codexly-data` 命名卷挂载到容器 `/home/node/.codex`，保存以下数据：

- Codex 登录凭据和 `config.toml`
- Codexly SQLite 状态
- 会话历史及其他 Codex Home 数据

查看卷：

```bash
docker volume inspect codexly_codexly-data
```

需要复用宿主 Codex Home 时设置绝对路径：

```dotenv
CODEXLY_CODEX_HOME=/home/example/.codex
```

宿主目录必须允许容器内 `node` 用户读写。不要让两个 Codexly 实例同时使用同一个 Codex Home。

## 配置工作区

不设置 `CODEXLY_WORKSPACE` 时，Compose 尝试挂载宿主 `/`，因此 Linux 上可选择根目录下的磁盘和项目。Docker Desktop 仍只能访问已经共享给 Docker 的目录。

限制为单个项目目录：

```dotenv
CODEXLY_WORKSPACE=/home/example/projects
```

Windows Docker Desktop 使用正斜杠路径，例如：

```dotenv
CODEXLY_WORKSPACE=C:/Users/example/projects
```

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

| 变量                    | 默认值         | 用途                                     |
| ----------------------- | -------------- | ---------------------------------------- |
| `CODEXLY_VERSION`       | `latest`       | GHCR 镜像标签                            |
| `CODEXLY_PORT`          | `3210`         | 宿主和容器监听端口                       |
| `CODEXLY_WORKSPACE`     | `/`            | 挂载到 `/workspace` 的宿主目录           |
| `CODEXLY_CODEX_HOME`    | `codexly-data` | Codex Home 的命名卷或宿主绝对路径        |
| `CODEXLY_LAN_PASSWORD`  | 随机生成       | 固定配对密码                             |
| `CODEXLY_SESSION_TTL`   | 当前进程有效   | 会话期限，例如 `12h`                     |
| `CODEXLY_ALLOWED_HOSTS` | 空             | 反向代理允许的精确域名，多个值用逗号分隔 |

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
