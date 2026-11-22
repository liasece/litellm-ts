MAKEFLAGS += --no-print-directory
# 快速档最多 6 个目标同时启动（含 jest 的 4 个 worker），峰值约 10 个进程；
# 16 核机器仍有余量，核数更少时用 MAKE_JOBS=4 覆盖。-k 保证全量档失败时其余检查仍跑完。
MAKE_JOBS ?= 6
PARALLEL_MAKE = $(MAKE) -j$(MAKE_JOBS) -k
FRONTEND_DIR = ui/litellm-dashboard
# 两档共用同一份快速项清单，避免 ci-full 与 ci 漂移。
CI_FAST_TARGETS = lint typecheck test check-circular check-drizzle-journal check-format
CI_FULL_TARGETS = test-types check-frontend

.PHONY: all
all: install ci ## 完整构建：安装依赖、运行快速门禁

.PHONY: help
help: ## 显示帮助信息（两档：make ci 快速档 / make ci-full 全量档）
	@echo "快速档 make ci：日常提交前的后端门禁，约 10–30s"
	@echo "全量档 make ci-full：快速档 + test:types + 前端四项，约 1–2 分钟，发布前跑"
	@echo
	@grep -h -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

.PHONY: install
install: ## 安装所有依赖（依赖未变化时跳过）
	@if [ ! -d node_modules ] || [ package.json -nt node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then \
		echo 安装依赖; \
		npm i --silent; \
	else \
		echo 依赖未变化，跳过 npm i; \
	fi

.PHONY: ci
ci: ## 快速门禁：lint、typecheck、单测、循环依赖、迁移登记、格式
	@$(PARALLEL_MAKE) $(CI_FAST_TARGETS)

.PHONY: ci-full
ci-full: ## 全量门禁：快速档 + 测试文件类型 + 前端四项（发布前跑）
	@$(PARALLEL_MAKE) $(CI_FAST_TARGETS) $(CI_FULL_TARGETS)

.PHONY: check-frontend
check-frontend: ## 检查前端四项：vue-tsc、vitest、eslint、prettier
	@echo 检查前端类型
	@npm --prefix $(FRONTEND_DIR) run typecheck
	@echo 检查前端单测
	@npm --prefix $(FRONTEND_DIR) run test
	@echo 检查前端 eslint 错误
	@npm --prefix $(FRONTEND_DIR) run lint
	@echo 检查前端格式
	@npm --prefix $(FRONTEND_DIR) run format:check

.PHONY: check-circular
check-circular: ## 检查循环导入
	@npx madge --circular --extensions ts src/

.PHONY: check-drizzle-journal
check-drizzle-journal: ## 检查迁移文件是否在 journal 中注册
	@bash scripts/check-drizzle-journal.sh

.PHONY: check-format
check-format: ## 检查代码格式
	@npx prettier --check "src/**/*.ts"

.PHONY: lint
lint: ## 检查 ESLint 错误
	@echo 检查 eslint 错误
	@npx eslint . --cache --cache-location .cache/eslint
	@echo 检查 eslint 错误结束

.PHONY: lint-fix
lint-fix: ## 自动修复 ESLint 错误
	@npx eslint . --fix

.PHONY: typecheck
typecheck: ## 类型检查（与 build 分用增量缓存）
	@npm run typecheck

.PHONY: test-types
test-types: ## 测试文件类型检查（Jest 走 isolatedModules，不做类型检查）
	@npm run test:types

.PHONY: test
test: ## 运行单元测试
	@npm run test

.PHONY: build
build: ## 构建项目
	@npm run build

.PHONY: clean
clean: ## 清理构建产物
	@rm -rf dist .cache tsconfig.tsbuildinfo

.PHONY: format
format: ## 格式化代码
	@npx prettier --write "src/**/*.ts"
