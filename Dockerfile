FROM node:22-alpine

WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 安装生产依赖
RUN npm ci --only=production && npm cache clean --force

# 复制编译产物和配置文件
COPY dist/ ./dist/
COPY config.litellm.yaml ./config.yaml
COPY drizzle ./drizzle

# 暴露端口
EXPOSE 4000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

# 启动
CMD ["node", "dist/main.js"]
