MAKEFLAGS += --no-print-directory
PARALLEL_MAKE = $(MAKE) -j

.PHONY: all
all: install ci ## 完整构建：安装依赖、运行CI

.PHONY: help
help: ## 显示帮助信息
	@grep -h -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

.PHONY: install
install: ## 安装所有依赖
	@npm i --silent

.PHONY: ci
ci: ## 运行所有 CI 检查
	@$(PARALLEL_MAKE) lint typecheck test check-circular check-drizzle-journal check-format

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
typecheck: ## 类型检查
	@npx tsc --noEmit

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
