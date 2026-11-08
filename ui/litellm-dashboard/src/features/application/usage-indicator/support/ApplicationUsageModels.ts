export interface ApplicationUsageData {
	total_users: number | null;
	total_users_used: number;
	total_users_remaining: number | null;
	total_teams: number | null;
	total_teams_used: number;
	total_teams_remaining: number | null;
}
export interface ApplicationLicenseInfo {
	has_license: boolean;
	license_type: string | null;
	expiration_date: string | null;
	allowed_features: string[];
	limits: { max_users: number | null; max_teams: number | null };
}
export interface UsageQuotaMetrics {
	isOverLimit: boolean;
	isNearLimit: boolean;
	usagePercentage: number;
}
