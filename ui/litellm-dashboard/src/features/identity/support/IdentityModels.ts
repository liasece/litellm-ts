export interface WorkerInfo {
	worker_id: string;
	name: string;
	url: string;
}

export interface UiConfig {
	server_root_path: string;
	proxy_base_url: string | null;
	auto_redirect_to_sso: boolean;
	admin_ui_disabled: boolean;
	sso_configured: boolean;
	is_control_plane?: boolean;
	workers?: WorkerInfo[];
}

export interface WebUiSessionInfo {
	authenticated: true;
	user_id: string;
	user_email: string | null;
	user_role: string;
	login_method: string;
	premium_user: boolean;
	disabled_non_admin_personal_key_creation: boolean;
	server_root_path: string;
}

export interface LoginResult {
	redirect_url: string;
	code?: string;
	expires_in?: number;
}

export interface LoginOptions {
	workerId?: string | null;
	useV3?: boolean;
}
