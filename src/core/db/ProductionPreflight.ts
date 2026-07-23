import { loadConfig } from "../config";
import { ReadOnlyPreflightError, runReadOnlySchemaPreflight } from "./Database";

interface FailedPreflightOutput {
	/** 执行状态。 */
	readonly status: "error";
	/** 失败阶段。 */
	readonly stage: string;
	/** 稳定错误码。 */
	readonly code: string;
	/** 脱敏错误信息。 */
	readonly message: string;
}

function failedOutput(error: unknown): FailedPreflightOutput {
	if (error instanceof ReadOnlyPreflightError) {
		return {
			status: "error",
			stage: error.stage,
			code: error.code,
			message: error.message,
		};
	}
	return {
		status: "error",
		stage: "config",
		code: "CONFIGURATION_FAILED",
		message: "Production preflight configuration is invalid",
	};
}

/** 执行生产数据库只读接管门禁，并向 stdout 输出单个脱敏 JSON。 */
export async function runProductionPreflight(): Promise<void> {
	try {
		const config = loadConfig();
		const result = await runReadOnlySchemaPreflight(config.database);
		process.stdout.write(`${JSON.stringify(result)}\n`);
	} catch (error) {
		process.stdout.write(`${JSON.stringify(failedOutput(error))}\n`);
		process.exitCode = 1;
	}
}

if (require.main === module) {
	void runProductionPreflight();
}
