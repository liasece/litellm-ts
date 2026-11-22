/**
 * 隐私脱敏规则里列表型字段的上限。
 *
 * 放在独立叶子文件里：`PrivacyConfig.ts`（解析配置）与 `PrivacyScope.ts`（判定作用域）
 * 互相引用，把常量抽出来两边都只依赖这里，判定逻辑与配置解析的顺序就无关了。
 */

/** 单个列表项的字符上限。 */
export const PRIVACY_SCOPE_ENTRY_MAX_LENGTH = 64;

/** 单个列表的条目上限。 */
export const PRIVACY_SCOPE_ENTRY_MAX_COUNT = 50;
