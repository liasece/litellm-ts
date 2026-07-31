export interface ModelInfo {
	id: string;
	created_at: string;
	updated_at: string;
	created_by: string;
	team_id: string;
	db_model: boolean;
	access_groups: string[] | null;
	/** 该 model_group 当前 fallback 链（/v2/model/info 注入，无配置为空数组） */
	fallbacks?: string[];
	/** 强制把该逻辑模型解析到另一个模型组。 */
	override_model_name?: string;
	cache_read_input_token_cost?: number | null;
}

export interface LiteLLMParams {
	model: string;
	api_base?: string;
	input_cost_per_token?: number;
	output_cost_per_token?: number;
	custom_llm_provider?: string;
	litellm_credential_name?: string;
	[key: string]: any;
}

export interface ModelData {
	model_info: ModelInfo;
	model_name: string;
	provider: string;
	litellm_model_name: string;
	input_cost: string | null;
	output_cost: string | null;
	cache_read_input_cost: string | null;
	max_tokens: number;
	max_input_tokens: number;
	api_base?: string;
	litellm_params: LiteLLMParams;
	cleanedLitellmParams: Record<string, any>;
	accessToken?: string;
}

export interface ModelDashboardProps {
	accessToken: string;
	token: string;
	userRole: string;
	userID: string;
	modelData: { data: ModelData[] };
	keys: any[];
	setModelData: (data: any) => void;
	premiumUser: boolean;
	teams: any[];
}
